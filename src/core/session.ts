/**
 * What holds for this session only (one page load), never saved. DESIGN.md principle 7: at most one therapist mention
 * a session, so the intro letter, the diary card, Settings and "Copy your lists" ask here first.
 */
let therapistSaid = false;

/** True for the first caller this session, which may then mention a therapist; false for everyone after. */
export function mayMentionTherapist() {
  if (therapistSaid) return false;
  therapistSaid = true;
  return true;
}
