// The trainer's answer box starts filled with the AI draft. What gets sent is what the box shows:
// the trainer's edit when there is one, otherwise the draft as it stands. The Send button used to
// stay disabled until the trainer typed something, so an untouched draft could not be sent at all.
export function answerToSend(typed: string | undefined, draft: string): string {
  return (typed ?? draft).trim();
}
