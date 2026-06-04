/**
 * Notarization script for macOS app distribution.
 * Called by electron-builder after signing via the afterSign hook.
 *
 * Prerequisites:
 * 1. Apple Developer account with Developer ID Application certificate
 * 2. App-specific password for notarization (not your Apple ID password)
 *
 * Environment variables required:
 * - APPLE_ID: Your Apple ID email
 * - APPLE_ID_PASSWORD: App-specific password (generate at appleid.apple.com)
 * - APPLE_TEAM_ID: Your Apple Developer Team ID
 *
 * Usage:
 * 1. Set the environment variables above
 * 2. Add "afterSign": "scripts/notarize.js" to package.json build config
 * 3. Run: npm run build
 *
 * The script will:
 * 1. Skip notarization on non-macOS platforms
 * 2. Submit the app to Apple's notarization service
 * 3. Wait for notarization to complete (can take 5-30 minutes)
 * 4. Staple the notarization ticket to the app
 */

const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize on macOS
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping notarization: not building for macOS');
    return;
  }

  // Check for required environment variables
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const appleTeamId = process.env.APPLE_TEAM_ID;
  const allowUnsignedSkip = process.env.FIELD_THEORY_ALLOW_UNSIGNED_NOTARIZATION_SKIP === 'true';

  if (!appleId || !appleIdPassword || !appleTeamId) {
    const message = [
      'Notarization blocked: missing environment variables.',
      'Required: APPLE_ID, APPLE_ID_PASSWORD or APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID.',
      'Set FIELD_THEORY_ALLOW_UNSIGNED_NOTARIZATION_SKIP=true only for an intentional local unsigned package test.',
    ].join('\n');
    if (allowUnsignedSkip) {
      console.warn(message);
      console.warn('Skipping notarization because FIELD_THEORY_ALLOW_UNSIGNED_NOTARIZATION_SKIP=true.');
      return;
    }
    throw new Error(message);
  }

  // Get app name from package.json
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath}...`);
  console.log('This may take several minutes...');

  try {
    await notarize({
      tool: 'notarytool',
      appPath,
      appleId,
      appleIdPassword,
      teamId: appleTeamId,
    });

    console.log('Notarization complete!');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
};
