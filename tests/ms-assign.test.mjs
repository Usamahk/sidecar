import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: ['src/ai/ms/assign.ts'], bundle: true, write: false,
  platform: 'node', format: 'esm',
})
const { assignBatched } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

test('65 items and 80 themes respect both limits and preserve every ID mapping', async () => {
  const items = Array.from({ length: 65 }, (_, i) => ({ id: i + 100, text: `item-${i}` }))
  const themes = Array.from({ length: 80 }, (_, i) => ({ id: i + 1000, statement: `theme-${i}` }))
  let calls = 0
  const result = await assignBatched(items, themes, async (texts, statements) => {
    calls++
    assert.ok(texts.length > 0 && texts.length <= 32)
    assert.ok(statements.length > 0 && statements.length <= 32)
    return texts.map(() => statements.map(() => ({ answer: true, probability: 0.9 })))
  })
  assert.equal(calls, 9)
  assert.equal(result.length, 65 * 80)
  assert.equal(new Set(result.map(r => `${r.itemId}:${r.themeId}`)).size, 65 * 80)
  for (const item of items) for (const theme of themes) {
    assert.ok(result.some(r => r.itemId === item.id && r.themeId === theme.id))
  }
})

test('negative and low-confidence answers are excluded', async () => {
  const result = await assignBatched([{ id: 1, text: 'text' }], [1, 2, 3].map(id => ({ id, statement: `${id}` })), async () => [[
    { answer: false, probability: 0.99 },
    { answer: true, probability: 0.74 },
    { answer: true, probability: 0.75 },
  ]])
  assert.deepEqual(result, [{ itemId: 1, themeId: 3, confidence: 0.75 }])
})

test('request errors and malformed results propagate for caller fallback', async () => {
  const items = [{ id: 1, text: 'text' }]
  const themes = [{ id: 2, statement: 'statement' }]
  await assert.rejects(assignBatched(items, themes, async () => { throw new Error('offline') }), /offline/)
  await assert.rejects(assignBatched(items, themes, async () => []), /result shape/)
})
