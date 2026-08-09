const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CP1252_BYTES = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function repairMojibake(value) {
  if (!value.includes('\u00e2')) return value;
  const bytes = [];
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code <= 0xff) bytes.push(code);
    else if (CP1252_BYTES.has(code)) bytes.push(CP1252_BYTES.get(code));
    else return value;
  }
  return Buffer.from(bytes).toString('utf8');
}

function normalizeLabel(value) {
  return repairMojibake(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2192/g, '->')
    .replace(/[*_`]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  return normalizeLabel(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildFrameworkCatalog(sourceText) {
  const families = [];
  const relations = [];
  let current = null;

  for (const line of sourceText.split(/\r?\n/)) {
    const heading = line.match(/^## (\d+)\. (.+)$/);
    if (heading) {
      const number = Number(heading[1]);
      if (number <= 23) {
        const name = normalizeLabel(heading[2]);
        current = {
          id: `family-${String(number).padStart(2, '0')}-${slug(name)}`,
          number,
          name,
        };
        families.push(current);
      } else {
        current = null;
      }
      continue;
    }
    if (line.startsWith('## ')) {
      current = null;
      continue;
    }
    const item = current && line.match(/^\* (.+)$/);
    if (item) {
      relations.push({
        name: normalizeLabel(item[1]),
        familyId: current.id,
        familyNumber: current.number,
      });
    }
  }

  const grouped = new Map();
  for (const relation of relations) {
    const key = relation.name.toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: slug(relation.name),
        name: relation.name,
        familyIds: [],
      });
    }
    const entry = grouped.get(key);
    if (!entry.familyIds.includes(relation.familyId)) entry.familyIds.push(relation.familyId);
  }

  const usedIds = new Map();
  const frameworks = [];
  for (const entry of grouped.values()) {
    let id = entry.id;
    if (usedIds.has(id) && usedIds.get(id) !== entry.name) {
      id += `-${crypto.createHash('sha256').update(entry.name).digest('hex').slice(0, 8)}`;
    }
    usedIds.set(id, entry.name);
    frameworks.push({ id, name: entry.name, familyIds: entry.familyIds });
  }

  const familyOrder = new Map(families.map(family => [family.id, family.number]));
  frameworks.sort((left, right) => (
    familyOrder.get(left.familyIds[0]) - familyOrder.get(right.familyIds[0])
    || left.name.localeCompare(right.name)
  ));

  return {
    format: 'contractor-ai/framework-catalog-v1',
    version: 1,
    source: 'Goal objective sections 1 through 23',
    families,
    frameworks,
    counts: {
      families: families.length,
      frameworks: frameworks.length,
      familyMemberships: relations.length,
    },
  };
}

function generateFrameworkCatalog(sourceFile, outputFile) {
  const catalog = buildFrameworkCatalog(fs.readFileSync(sourceFile, 'utf8'));
  if (catalog.counts.families !== 23 || catalog.counts.familyMemberships !== 700) {
    throw new Error(`Framework source coverage changed: ${JSON.stringify(catalog.counts)}`);
  }
  const json = `${JSON.stringify(catalog, null, 2)}\n`;
  if ([...json].some(character => character.charCodeAt(0) > 127)) {
    throw new Error('Generated framework catalog is not ASCII-safe.');
  }
  fs.writeFileSync(outputFile, json, 'utf8');
  return catalog;
}

if (require.main === module) {
  const sourceFile = process.argv[2];
  const outputFile = path.resolve(process.argv[3] || path.join(__dirname, '..', 'contractor-framework-catalog.json'));
  if (!sourceFile || !path.isAbsolute(sourceFile)) {
    throw new Error('Pass the absolute goal-objective Markdown path as the first argument.');
  }
  const catalog = generateFrameworkCatalog(sourceFile, outputFile);
  process.stdout.write(`${JSON.stringify({ outputFile, ...catalog.counts })}\n`);
}

module.exports = {
  buildFrameworkCatalog,
  generateFrameworkCatalog,
  normalizeLabel,
  repairMojibake,
  slug,
};
