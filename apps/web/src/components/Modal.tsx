/* Generic modal infrastructure: backdrop, Esc, initial focus, aria. */

import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, children, footer, wide }: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const first = boxRef.current?.querySelector<HTMLElement>(
      'button:not(:disabled), [tabindex]',
    );
    first?.focus();
  }, []);

  return (
    <div
      className="if-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={boxRef}
        className="if-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={wide ? { maxWidth: 640 } : undefined}
      >
        <div className="if-modal__head">
          <h2 className="if-modal__title">{title}</h2>
          {onClose && (
            <button className="if-icon-btn" onClick={onClose} aria-label="Close dialog">
              ✕
            </button>
          )}
        </div>
        <div className="if-modal__body if-scroll">{children}</div>
        {footer && <div className="if-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="if-btn if-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`if-btn ${danger ? 'if-btn--danger' : 'if-btn--primary'}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="if-modal__text">{message}</p>
    </Modal>
  );
}
