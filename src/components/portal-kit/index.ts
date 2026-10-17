// The portal kit: the client portal v2 look as shared pieces (plan §2.5).
// Copied from client-portal-view.tsx, which stays untouched until R3.
export { PortalTheme, PortalStyles, PORTAL_CSS, portalScopeClass, usePortalScopeClass, usePortalVariant, safeArea } from "./theme";
export type { PortalVariant } from "./theme";
export { PortalHeader, HeaderAction } from "./header";
export { PortalTabBar, useHashTab } from "./tab-bar";
export type { PortalTabDef } from "./tab-bar";
export { PortalSheet, lockBodyScroll, useBodyScrollLock, useIsClient, useOverlayLayer } from "./sheet";
export { Empty } from "./empty";
export { PreviewBanner, StaffChip, STAFF_MAROON } from "./preview-banner";
export { PhotoViewer, PhotoGrid } from "./photo-viewer";
export type { ViewerPhoto } from "./photo-viewer";
export { DocumentList, documentBadge } from "./document-list";
export type { DocumentListGroup, DocumentListItem } from "./document-list";
export { TimelineList, TimelineRow, TIMELINE_CHIP, firmDates } from "./timeline-row";
export type { TimelineChip, TimelineChipKey } from "./timeline-row";
export { MoneySummary, PAID_GREEN } from "./money-summary";
export type { MoneyStat } from "./money-summary";
export { PortalNotice } from "./notice";
export type { NoticeTone, PortalNoticeValue } from "./notice";
export { usePortalAction } from "./use-portal-action";
export type { PortalAction, PortalActionOptions } from "./use-portal-action";
