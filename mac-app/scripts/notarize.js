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
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const appleTeamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !appleTeamId) {
    console.log('Skipping notarization: missing environment variables');
    console.log('Required: APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID');
    console.log('');
    console.log('To enable notarization:');
    console.log('1. Create an app-specific password at https://appleid.apple.com');
    console.log('2. Export APPLE_ID="your-email@example.com"');
    console.log('3. Export APPLE_ID_PASSWORD="your-app-specific-password"');
    console.log('4. Export APPLE_TEAM_ID="YOUR_TEAM_ID"');
    return;
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

