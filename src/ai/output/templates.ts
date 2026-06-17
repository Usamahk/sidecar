/**
 * Output format registry. Each template is *data* — a structure prompt over a
 * dossier — so new formats (tweet thread, research study, slide deck) are added
 * here without touching the generator. `okfType` becomes the output concept's
 * OKF type.
 */

export interface OutputTemplate {
  id: string
  label: string
  okfType: string
  /** Format-specific structure guidance handed to the output model. */
  structurePrompt: string
}

export const OUTPUT_TEMPLATES: OutputTemplate[] = [
  {
    id: 'newsletter',
    label: 'Newsletter',
    okfType: 'Newsletter Draft',
    structurePrompt: [
      'Write a single newsletter issue aimed at a curious, informed reader.',
      'Structure: an opening hook (2–3 sentences), 2–3 threaded sections each with',
      'a bold subheading and a concrete takeaway, and a short closing thought.',
      'Weave in the most interesting specifics from the dossier; keep links to',
      'sources where they add credibility. Aim for ~500–800 words.',
    ].join(' '),
  },
]

export function getTemplate(id: string): OutputTemplate | undefined {
  return OUTPUT_TEMPLATES.find((t) => t.id === id)
}
