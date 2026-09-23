import type { SurveyQuestion } from "./types";

export interface SurveyTemplate {
  key: string;
  title: string;
  description: string;
  thank_you_message: string;
  questions: Omit<SurveyQuestion, "id">[];
}

/** Starting points for the builder. Ids are assigned when the template is loaded. */
export const SURVEY_TEMPLATES: SurveyTemplate[] = [
  {
    key: "client_satisfaction",
    title: "Post-Project Client Satisfaction",
    description:
      "Thank you for choosing Penney Construction. Your feedback takes two minutes and helps us build better.",
    thank_you_message: "Thank you! We appreciate you taking the time. — The Penney Construction team",
    questions: [
      { type: "nps", label: "How likely are you to recommend Penney Construction to a friend or neighbor?", required: true },
      { type: "rating", label: "How would you rate the quality of the finished work?", required: true },
      { type: "rating", label: "How would you rate communication throughout the project?", required: true },
      { type: "rating", label: "How clean and organized was the job site?", required: false },
      { type: "single_choice", label: "Did the project finish on the schedule we set?", required: true, options: ["Yes, on time", "A little late", "Significantly late", "Early"] },
      { type: "single_choice", label: "Did the final cost match what you expected?", required: true, options: ["Yes", "Close, with approved changes", "No, higher than expected"] },
      { type: "long_text", label: "What did we do well?", required: false },
      { type: "long_text", label: "What could we have done better?", required: false },
      { type: "yes_no", label: "May we use photos of your project in our portfolio?", required: false },
    ],
  },
  {
    key: "precon_intake",
    title: "Pre-Construction Questionnaire",
    description:
      "Help us prepare for your walkthrough. A few quick questions about your project and priorities.",
    thank_you_message: "Thanks! We'll review this before our walkthrough and come prepared.",
    questions: [
      { type: "multiple_choice", label: "What kind of work are you considering?", required: true, options: ["Kitchen", "Bathroom", "Addition", "Basement", "Exterior / siding / roofing", "Windows & doors", "Deck / porch", "Whole-house renovation", "Other"] },
      { type: "single_choice", label: "When would you like to start?", required: true, options: ["As soon as possible", "1–3 months", "3–6 months", "6–12 months", "Just exploring"] },
      { type: "single_choice", label: "What is your budget range?", required: true, options: ["Under $50k", "$50k–$100k", "$100k–$250k", "$250k–$500k", "Over $500k", "Not sure yet"] },
      { type: "yes_no", label: "Do you have architectural plans or drawings?", required: true },
      { type: "yes_no", label: "Have you worked with a contractor on this home before?", required: false },
      { type: "single_choice", label: "What matters most to you on this project?", required: true, options: ["Staying on budget", "Finishing quickly", "Highest quality finishes", "Minimal disruption to daily life"] },
      { type: "long_text", label: "Describe what you want to accomplish.", required: true },
      { type: "short_text", label: "How did you hear about us?", required: false },
    ],
  },
  {
    key: "sub_feedback",
    title: "Subcontractor Job Feedback",
    description: "Quick feedback on how the job ran from your side so we can coordinate better next time.",
    thank_you_message: "Thanks — we read every one of these.",
    questions: [
      { type: "rating", label: "How clear was the scope you were given?", required: true },
      { type: "rating", label: "How well was the schedule coordinated with other trades?", required: true },
      { type: "rating", label: "Was the site ready when you arrived?", required: true },
      { type: "yes_no", label: "Were you paid on the agreed terms?", required: true },
      { type: "long_text", label: "What would make working with Penney easier?", required: false },
    ],
  },
];
