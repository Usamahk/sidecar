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
  {
    id: 'blog',
    label: 'Blog post',
    okfType: 'Blog Draft',
    structurePrompt: [
      'Write a standalone blog post with a clear point of view.',
      'Structure: a compelling title (# heading), a short intro that frames the',
      'stakes, 3–5 body sections with ## subheadings that build an argument, and',
      'a conclusion that lands the takeaway. Support claims with specifics and',
      'source links from the dossier. Aim for ~800–1200 words.',
    ].join(' '),
  },
]

export function getTemplate(id: string): OutputTemplate | undefined {
  return OUTPUT_TEMPLATES.find((t) => t.id === id)
}
