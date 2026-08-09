# Accessibility Assurance

Contractor.AI treats accessibility as a release requirement for the canonical
operator application and scoped client portal. The automated browser gate uses the
pinned `@axe-core/playwright` engine against WCAG 2.0 A/AA, WCAG 2.1 A/AA, and
WCAG 2.2 AA rules.

## Automated release scope

`e2e/accessibility.spec.js` verifies all twelve primary owner workspaces, the
opportunity, business-setup, and framework dialogs, mobile navigation, and the
client portal at mobile and desktop widths. `e2e/auth-session.spec.js` applies the
same rules to the production sign-in screen. Any matched axe violation fails the
browser release gate; rules are not disabled or excluded for individual controls.

The gate complements existing browser workflows for keyboard focus containment,
focus restoration, semantic names, mobile geometry, loading, error, empty, and
offline states. Contrast fixes use shared component colors so compact tables,
planning boards, field controls, scorecards, and client facts remain readable
without changing their information hierarchy.

## Commands

```powershell
npm run test:browser -- e2e/accessibility.spec.js e2e/auth-session.spec.js
npm run test:browser
```

## Remaining human acceptance

Automated rules cannot prove the complete experience for every assistive
technology or user. Before a hosted production launch, test the critical path with
keyboard-only navigation, browser zoom and reflow, Windows High Contrast Mode, and
current screen-reader/browser combinations with representative owner, office,
field, approver, and client users. Record findings and remediation in the release
evidence. Independent user testing remains external acceptance, not a claim made by
the repository gate.
