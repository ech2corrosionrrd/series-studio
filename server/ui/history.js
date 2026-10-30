/**
 * The credit history: the ledger keeps short English notes ("image generation", "archive", "refund: ...") and one row per charge.
 * Pure functions, no DOM: the unit test imports this file directly (BETA-REVIEW B7).
 */
const NOTES = {
  "image generation": "history.note.generation",
  archive: "history.note.archive",
  "arweave upload": "history.note.arweave",
  "deploy kit": "history.note.deployKit",
  "marketplace kit": "history.note.marketKit",
  compose: "history.note.compose",
  "vision assist": "history.note.vision",
  "ai triage": "history.note.triage",
};
const KINDS = { welcome: "history.kind.welcome", grant: "history.kind.grant", payment: "history.kind.payment", refund: "history.kind.refund" };

/** The label of one ledger row in the author's language; an unknown note is shown as it is. */
export function historyLabel(tx, t, hasKey) {
  const note = String(tx?.note || "");
  const refund = /^refund: (.+?)( failed)?$/.exec(note);
  if (refund) return t("history.note.refund", { what: historyLabel({ note: refund[1] }, t, hasKey) });
  const noteKey = NOTES[note];
  if (noteKey && hasKey(noteKey)) return t(noteKey);
  const kindKey = !note && KINDS[tx?.kind];
  if (kindKey && hasKey(kindKey)) return t(kindKey);
  return note || String(tx?.kind || "");
}

/** Twenty-one charges of one frame batch in one minute are one row with ×21, not twenty-one rows. */
export function groupHistory(rows) {
  const out = [];
  for (const tx of rows || []) {
    const minute = String(tx.created_at).slice(0, 16);
    const last = out.at(-1);
    if (last && last.kind === tx.kind && last.note === tx.note && last.minute === minute && Math.sign(last.credits) === Math.sign(tx.credits)) {
      last.credits += tx.credits;
      last.count += 1;
    } else {
      out.push({ ...tx, minute, count: 1 });
    }
  }
  return out;
}
