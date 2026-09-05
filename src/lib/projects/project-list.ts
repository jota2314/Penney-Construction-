export const PRECONSTRUCTION_STATUSES = new Set([
  "lead", "estimating", "waiting_for_approval", "proposal_sent", "contracted",
]);

export function matchesProjectStage(status: string, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "preconstruction") return PRECONSTRUCTION_STATUSES.has(status);
  if (filter === "work") return PRECONSTRUCTION_STATUSES.has(status) || status === "in_progress";
  return status === filter;
}

interface SearchableProject {
  name: string;
  project_number: string;
  status: string;
  assigned_pm?: string | null;
  project_manager_name?: string | null;
  city?: string | null;
  address?: string | null;
  customer?: { first_name: string; last_name: string } | null;
}

export function matchesProjectList(
  project: SearchableProject,
  { search, stage, mine, viewerId }: { search: string; stage: string; mine: boolean; viewerId: string },
): boolean {
  const query = search.trim().toLowerCase();
  // Search always spans every accessible project, regardless of the selected tabs.
  if (query) {
    return [project.name, project.project_number, project.city, project.address,
      project.project_manager_name,
      project.customer && `${project.customer.first_name} ${project.customer.last_name}`,
    ].some((value) => value?.toLowerCase().includes(query));
  }
  return (!mine || project.assigned_pm === viewerId) && matchesProjectStage(project.status, stage);
}
