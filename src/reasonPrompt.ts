import { askText } from './components/AppDialog';

// Asks for the note that goes with a request for approval. Resolves to null when cancelled.
export const askReason = (action: string): Promise<string | null> =>
  askText(`Why do you want to ${action}? The approver will see this note.`, '', {
    title: 'Add a note',
    label: 'Your note',
    multiline: true,
    minLength: 3,
    placeholder: 'For example: the supplier sent a different count',
    confirmLabel: 'Send for approval',
  });
