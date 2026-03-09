import type { JSX } from 'react';
import type { WorkflowIconKey, WorkflowTone } from '@/lib/workflowDirectory';

export default function WorkflowIcon({
  name,
  tone,
}: {
  name: WorkflowIconKey;
  tone: WorkflowTone;
}): JSX.Element {
  switch (name) {
    case 'document':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-current"
          data-tone={tone}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 3.5h7l4.5 4.5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" />
          <path d="M14 3.5V9h5" />
          <path d="M9 14h6" />
          <path d="M9 18h6" />
        </svg>
      );
    case 'layers':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-current"
          data-tone={tone}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 4 4 8l8 4 8-4-8-4Z" />
          <path d="m4 12 8 4 8-4" />
          <path d="m4 16 8 4 8-4" />
        </svg>
      );
    case 'target':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-current"
          data-tone={tone}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3" />
          <path d="M12 19v3" />
          <path d="M2 12h3" />
          <path d="M19 12h3" />
        </svg>
      );
    case 'bank':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-current"
          data-tone={tone}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 9.5 12 4l9 5.5" />
          <path d="M4.5 10.5h15" />
          <path d="M6.5 10.5v7" />
          <path d="M10.5 10.5v7" />
          <path d="M14.5 10.5v7" />
          <path d="M18.5 10.5v7" />
          <path d="M4 19h16" />
        </svg>
      );
    case 'spreadsheet':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-current"
          data-tone={tone}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 3.5h10A1.5 1.5 0 0 1 18.5 5v14A1.5 1.5 0 0 1 17 20.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
          <path d="M8.5 8.5h7" />
          <path d="M8.5 12h7" />
          <path d="M8.5 15.5h7" />
          <path d="M11 8v8" />
        </svg>
      );
    case 'receipt':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-current"
          data-tone={tone}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 3.5h10A1.5 1.5 0 0 1 18.5 5v14l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5V5A1.5 1.5 0 0 1 7 3.5Z" />
          <path d="M8.5 8h7" />
          <path d="M8.5 11.5h7" />
          <path d="M8.5 15h4.5" />
        </svg>
      );
    case 'clipboard':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-current"
          data-tone={tone}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 4.5h6" />
          <path d="M9.75 3.5h4.5A1.25 1.25 0 0 1 15.5 4.75v.75h1.25A1.75 1.75 0 0 1 18.5 7.25v11A1.75 1.75 0 0 1 16.75 20h-9.5A1.75 1.75 0 0 1 5.5 18.25v-11A1.75 1.75 0 0 1 7.25 5.5H8.5v-.75A1.25 1.25 0 0 1 9.75 3.5Z" />
          <path d="M8.5 10h7" />
          <path d="M8.5 13.5h7" />
          <path d="M8.5 17h4" />
        </svg>
      );
    case 'globe':
    default:
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-current"
          data-tone={tone}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16" />
          <path d="M12 4a12 12 0 0 1 3.5 8A12 12 0 0 1 12 20a12 12 0 0 1-3.5-8A12 12 0 0 1 12 4Z" />
        </svg>
      );
  }
}
