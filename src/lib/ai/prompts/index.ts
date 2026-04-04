/**
 * Prompt system index — clean exports for all 4 chat types.
 */

export { buildBasePrompt } from "./base";
export { buildBrainPrompt } from "./brain";
export { buildProjectPrompt, type ProjectChatContext } from "./project";
export { buildEmailTriagePrompt, type EmailTriageContext } from "./email-triage";
export { buildSchedulePrompt, type ScheduleChatContext } from "./schedule";
