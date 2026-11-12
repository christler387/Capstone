// Asks for the note that goes with a request for approval.
// Returns null when the person cancels or the note is too short.
export const askReason = (action: string): string | null => {
  const answer = window.prompt(`Why do you want to ${action}? The approver will see this note.`);
  if (answer === null) return null;
  const note = answer.trim();
  if (note.length < 3) {
    window.alert('Please write a short note explaining why (at least 3 characters).');
    return null;
  }
  return note;
};
