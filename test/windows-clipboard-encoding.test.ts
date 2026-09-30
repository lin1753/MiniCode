import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const ttyAppModulePromise = import('../src/tty-app.ts')

describe('Windows clipboard encoding', () => {
  it('encodes clipboard text as UTF-16LE with BOM on win32', async () => {
    const ttyAppModule = await ttyAppModulePromise
    const encodeClipboardTextForPlatform =
      (ttyAppModule as {
        encodeClipboardTextForPlatform?: (platform: NodeJS.Platform, text: string) => string | Buffer
      }).encodeClipboardTextForPlatform

    assert.equal(typeof encodeClipboardTextForPlatform, 'function')

    const encoded = encodeClipboardTextForPlatform!('win32', '这是一个最小骨架版本。')

    assert.ok(Buffer.isBuffer(encoded))
    assert.equal(encoded[0], 0xff)
    assert.equal(encoded[1], 0xfe)
    assert.equal(encoded.subarray(2).toString('utf16le'), '这是一个最小骨架版本。')
  })

  it('builds standard OSC 52 clipboard escape sequence', async () => {
    const ttyAppModule = await ttyAppModulePromise
    const buildOsc52Sequence =
      (ttyAppModule as {
        buildOsc52Sequence?: (text: string) => string
      }).buildOsc52Sequence

    assert.equal(typeof buildOsc52Sequence, 'function')

    const seq = buildOsc52Sequence!('hello world')
    const expectedBase64 = Buffer.from('hello world', 'utf8').toString('base64')
    assert.equal(seq, `\x1b]52;c;${expectedBase64}\x07`)
  })
})
