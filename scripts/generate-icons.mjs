/**
 * Generate all app icons from src/assets/armadillo.png
 *
 * Produces:
 *  - electron/icon.png (256x256 for electron-builder)
 *  - electron/icon.ico (multi-size ICO for Windows)
 *  - public/favicon.png (32x32 for web)
 *  - public/apple-touch-icon.png (180x180)
 *  - android mipmap icons (ic_launcher + ic_launcher_round + ic_launcher_foreground)
 */

import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const src = join(root, 'src', 'assets', 'armadillo.png')

// Android mipmap sizes
const androidSizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
}

// Android adaptive icon foreground sizes (108dp at each density)
const androidForegroundSizes = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
}

async function generatePng(inputPath, outputPath, size) {
  await sharp(inputPath)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(outputPath)
  console.log(`  ✓ ${outputPath} (${size}x${size})`)
}

async function generateRoundPng(inputPath, outputPath, size) {
  // Create a circular mask
  const roundedCorners = Buffer.from(
    `<svg><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`
  )

  const rounded = await sharp(inputPath)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .composite([{
      input: roundedCorners,
      blend: 'dest-in',
    }])
    .png()
    .toBuffer()

  writeFileSync(outputPath, rounded)
  console.log(`  ✓ ${outputPath} (${size}x${size} round)`)
}

async function generateForeground(inputPath, outputPath, totalSize) {
  // Adaptive icon foreground: the icon should be centered in the safe zone
  // Safe zone is 66/108 of total size (about 61%), centered
  const iconSize = Math.round(totalSize * 66 / 108)
  const padding = Math.round((totalSize - iconSize) / 2)

  const resized = await sharp(inputPath)
    .resize(iconSize, iconSize, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  await sharp({
    create: {
      width: totalSize,
      height: totalSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, left: padding, top: padding }])
    .png()
    .toFile(outputPath)

  console.log(`  ✓ ${outputPath} (${totalSize}x${totalSize} foreground)`)
}

// Build ICO file from multiple PNG sizes
function buildIco(pngBuffers) {
  // ICO format: header + directory entries + image data
  const numImages = pngBuffers.length
  const headerSize = 6
  const dirEntrySize = 16
  const dirSize = dirEntrySize * numImages
  const dataOffset = headerSize + dirSize

  // Calculate total size
  let totalDataSize = 0
  for (const { buffer } of pngBuffers) {
    totalDataSize += buffer.length
  }

  const ico = Buffer.alloc(headerSize + dirSize + totalDataSize)

  // ICO header
  ico.writeUInt16LE(0, 0) // reserved
  ico.writeUInt16LE(1, 2) // type: 1 = ICO
  ico.writeUInt16LE(numImages, 4) // number of images

  let currentDataOffset = dataOffset
  for (let i = 0; i < numImages; i++) {
    const { size, buffer } = pngBuffers[i]
    const entryOffset = headerSize + i * dirEntrySize

    ico.writeUInt8(size >= 256 ? 0 : size, entryOffset) // width (0 = 256)
    ico.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1) // height (0 = 256)
    ico.writeUInt8(0, entryOffset + 2) // color palette
    ico.writeUInt8(0, entryOffset + 3) // reserved
    ico.writeUInt16LE(1, entryOffset + 4) // color planes
    ico.writeUInt16LE(32, entryOffset + 6) // bits per pixel
    ico.writeUInt32LE(buffer.length, entryOffset + 8) // image data size
    ico.writeUInt32LE(currentDataOffset, entryOffset + 12) // data offset

    buffer.copy(ico, currentDataOffset)
    currentDataOffset += buffer.length
  }

  return ico
}

async function main() {
  console.log('Generating icons from', src)
  console.log('')

  // ---- Electron icons ----
  console.log('Electron:')
  await generatePng(src, join(root, 'electron', 'icon.png'), 256)

  // Generate ICO with multiple sizes
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoPngs = []
  for (const size of icoSizes) {
    const buffer = await sharp(src)
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer()
    icoPngs.push({ size, buffer })
  }
  const icoBuffer = buildIco(icoPngs)
  writeFileSync(join(root, 'electron', 'icon.ico'), icoBuffer)
  console.log(`  ✓ electron/icon.ico (multi-size)`)

  // ---- Web icons ----
  console.log('\nWeb:')
  await generatePng(src, join(root, 'public', 'favicon.png'), 32)
  await generatePng(src, join(root, 'public', 'icon-192.png'), 192)
  await generatePng(src, join(root, 'public', 'icon-512.png'), 512)
  await generatePng(src, join(root, 'public', 'apple-touch-icon.png'), 180)

  // ---- Android icons ----
  console.log('\nAndroid:')
  const resDir = join(root, 'android', 'app', 'src', 'main', 'res')

  for (const [folder, size] of Object.entries(androidSizes)) {
    const dir = join(resDir, folder)
    // ic_launcher (square with rounded corners handled by system)
    await generatePng(src, join(dir, 'ic_launcher.png'), size)
    // ic_launcher_round (circular)
    await generateRoundPng(src, join(dir, 'ic_launcher_round.png'), size)
  }

  for (const [folder, size] of Object.entries(androidForegroundSizes)) {
    const dir = join(resDir, folder)
    await generateForeground(src, join(dir, 'ic_launcher_foreground.png'), size)
  }

  console.log('\n✓ All icons generated!')
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
