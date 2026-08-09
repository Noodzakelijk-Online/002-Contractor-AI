# Privacy Rights Operations

Contractor.AI provides an owner-controlled register for handling access,
rectification, erasure, restriction, portability, and objection requests. It is an
operational aid, not a substitute for legal review or the organization's privacy
policy.

The workflow follows the practical boundaries in GDPR Articles 12 through 20 and
the Dutch Data Protection Authority guidance:

- [GDPR consolidated text](https://eur-lex.europa.eu/eli/reg/2016/679/2016-05-04)
- [Dutch DPA guidance for organizations](https://autoriteitpersoonsgegevens.nl/themas/basis-avg/privacyrechten-avg/voor-organisaties-privacyrechten-in-de-praktijk)

## Owner Workflow

1. Register the request against the current client or worker record. The default
   deadline is one calendar month after receipt.
2. Verify identity using the least intrusive suitable method. Retain only a method
   and evidence reference; do not upload or paste a full identity-document copy.
3. Review the live data inventory, possible third-party data, statutory or
   contractual retention duties, active work, financial records, and safety or
   audit evidence.
4. Record an assessment with the relevant legal-basis and retention-policy
   references. An extension is limited to two additional calendar months and needs
   a recorded reason and notification reference.
5. Send the proposed action to a separate approver. Approval is source-bound: a
   changed record invalidates the decision and requires a new assessment.
6. For approved access or portability requests, download the private JSON package,
   complete the human third-party-rights review, and use an approved delivery
   channel. Contractor.AI does not send the package.
7. Retain the request, decision, checksums, and audit trail according to the
   organization's retention policy.

## Product Boundaries

- Identity is not considered verified merely because a request exists.
- Access and portability exports are structured JSON, not automatic disclosures.
- Rectification changes only the explicitly selected current projection fields.
- Restriction and direct-marketing objection states block relevant new processing.
- Erasure is blocker-aware and performs partial pseudonymisation of eligible current
  identity projections. Immutable financial, contractual, safety, approval, and
  audit evidence may remain. The product never describes this as complete erasure.
- The register does not determine whether an exception, legal obligation, or
  competing right applies. The owner and approver must record that assessment.

## Recovery And Hosting

Operational exports include the privacy request register. SQLite backups and
local-to-hosted migration preserve requests, inventory hashes, deadlines, identity
evidence references, and approval results. Restore validation requires migration
`071_data_subject_request_governance`. Hosted use remains fail-closed until the EU
provider, DPA, retention policy, PostgreSQL recovery, and private object storage
requirements in [EU Hosting Path](EU_HOSTING.md) are configured and verified.
