/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import type { JSX } from 'react';
import WorkflowHubPage from '@/components/WorkflowHubPage';
import { getWorkflowCategory } from '@/lib/workflowDirectory';

export default function FinanceDirectoryPage(): JSX.Element {
  const category = getWorkflowCategory('finance');

  return (
    <WorkflowHubPage
      accent={category.summaryTone}
      badge={category.pageBadge}
      title={category.pageTitle}
      description={category.pageDescription}
      options={category.features}
    />
  );
}
