import { askText } from './components/AppDialog';

// Asks for the note that goes with a change. Staff send it for approval; an admin's note is kept on the stock card.
// Resolves to null when cancelled.
export const askReason = (action: string, forAdmin = false): Promise<string | null> =>
  askText(
    forAdmin
      ? `Why do you want to ${action}? The note is kept on the stock card.`
      : `Why do you want to ${action}? The approver will see this note.`,
    '',
    {
      title: 'Add a note',
      label: 'Your note',
      multiline: true,
      minLength: 3,
      placeholder: 'For example: the supplier sent a different count',
      confirmLabel: forAdmin ? 'Undo' : 'Send for approval',
    },
  );
