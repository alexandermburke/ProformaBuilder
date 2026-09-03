import Link from 'next/link';
import type { JSX } from 'react';

type BackLinkProps = {
  /** Where the button goes. Should be the page the user came from in the directory tree. */
  href: string;
  /** Rendered after the arrow, e.g. "Back to accounting". Must name the `href` destination. */
  label: string;
};

/**
 * The single back button used at the top-right of every page header. Keeps the destination,
 * arrow, size, and variant identical across the app so a "Back to X" link always looks and
 * sits the same way.
 */
export default function BackLink({ href, label }: BackLinkProps): JSX.Element {
  return (
    <Link href={href} className="ios-button shrink-0 px-4 py-2 text-sm" data-variant="secondary">
      <span aria-hidden className="-ml-1 mr-1 text-base">
        &larr;
      </span>
      {label}
    </Link>
  );
}
