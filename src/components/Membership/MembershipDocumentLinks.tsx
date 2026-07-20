import React from 'react';

const documents = [
  { label: 'Constitution', href: '/membership-documents/bfc-constitution-2019-07.pdf' },
  { label: 'By-laws', href: '/membership-documents/bfc-bylaws-2019-07.pdf' },
  { label: 'Code of Conduct', href: '/membership-documents/bfc-code-of-conduct-v1-2018-01-12.pdf' },
  { label: 'Members Manual', href: '/membership-documents/bfc-members-manual-2nd-edition-2024.pdf' },
] as const;

export const MembershipDocumentLinks: React.FC = () => (
  <span className="mt-2 block text-xs leading-5">
    Review:{' '}
    {documents.map((document, index) => (
      <React.Fragment key={document.href}>
        {index > 0 && ' · '}
        <a
          href={document.href}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
          onClick={event => event.stopPropagation()}
        >
          {document.label}
        </a>
      </React.Fragment>
    ))}
  </span>
);

export default MembershipDocumentLinks;
