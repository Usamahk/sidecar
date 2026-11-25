import { MIN_ASSIGN_PROBABILITY, MS_SCAN_TEXTS_BATCH, MS_SCAN_STATEMENTS_BATCH } from './constants'

type YesNo = (texts: string[], statements: string[]) => Promise<Array<Array<{
  answer: boolean
  probability: number
}>>>

export async function assignBatched(
  items: Array<{ id: number; text: string }>,
  themes: Array<{ id: number; statement: string }>,
  yesNo: YesNo
): Promise<Array<{ itemId: number; themeId: number; confidence: number }>> {
  const assignments: Array<{ itemId: number; themeId: number; confidence: number }> = []
  for (let i = 0; i < items.length; i += MS_SCAN_TEXTS_BATCH) {
    const itemBatch = items.slice(i, i + MS_SCAN_TEXTS_BATCH)
    for (let t = 0; t < themes.length; t += MS_SCAN_STATEMENTS_BATCH) {
      const themeBatch = themes.slice(t, t + MS_SCAN_STATEMENTS_BATCH)
      const results = await yesNo(itemBatch.map(item => item.text), themeBatch.map(theme => theme.statement))
      if (results.length !== itemBatch.length || results.some(row => row.length !== themeBatch.length)) {
        throw new Error('Milliseconds returned an unexpected assignment result shape.')
      }
      results.forEach((row, itemIndex) => {
        row.forEach((result, themeIndex) => {
          if (result.answer && Number.isFinite(result.probability) && result.probability >= MIN_ASSIGN_PROBABILITY) {
            assignments.push({
              itemId: itemBatch[itemIndex].id,
              themeId: themeBatch[themeIndex].id,
              confidence: result.probability,
            })
          }
        })
      })
    }
  }
  return assignments
}
