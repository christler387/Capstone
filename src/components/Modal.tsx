import React from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  type?: 'default' | 'mini' | 'clean';
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, type = 'default' }) => {
  if (!isOpen) return null;

  return (
    <div className={`modal-overlay active ${type === 'clean' ? 'clean-modal' : ''}`}>
      <div className={`modal-content ${type === 'mini' ? 'mini' : ''} ${type === 'clean' ? 'clean' : ''}`}>
        <div className={`modal-header ${type === 'clean' ? 'hidden' : ''}`}>
          <span className="label-micro">{title}</span>
          <button className="close-modal" onClick={onClose}><i className="bx bx-x"></i></button>
        </div>
        <div className="modal-body" style={{ padding: type === 'clean' ? '0' : '1.5rem' }}>
          {children}
        </div>
        {footer && (
          <div className={`modal-footer ${type === 'clean' ? 'hidden' : ''}`}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
