#!/usr/bin/env ruby
# Adds the LittleAIKeyboard custom keyboard extension target to littleai.xcodeproj.
# Idempotent: re-running is a no-op.

require 'xcodeproj'

PROJECT_PATH = File.expand_path('../littleai.xcodeproj', __dir__)
TARGET_NAME = 'LittleAIKeyboard'
BUNDLE_ID = 'com.afar1.littleai.keyboard'
GROUP_NAME = 'LittleAIKeyboard'
SOURCE_DIR = File.expand_path('../LittleAIKeyboard', __dir__)
DEPLOYMENT_TARGET = '15.1'
SWIFT_VERSION = '5.0'
DEVELOPMENT_TEAM = '3244UJ94D8'
APP_GROUP = 'group.com.afar1.littleai'

project = Xcodeproj::Project.open(PROJECT_PATH)

if project.targets.any? { |t| t.name == TARGET_NAME }
  puts "Target #{TARGET_NAME} already exists — nothing to do."
  exit 0
end

main_target = project.targets.find { |t| t.name == 'littleai' } or abort('main target littleai not found')

# 1. Create the extension target.
ext_target = project.new_target(
  :app_extension,
  TARGET_NAME,
  :ios,
  DEPLOYMENT_TARGET,
)

# 2. Configure build settings on both Debug and Release.
ext_target.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => BUNDLE_ID,
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'INFOPLIST_FILE' => "#{GROUP_NAME}/Info.plist",
    'CODE_SIGN_ENTITLEMENTS' => "#{GROUP_NAME}/#{TARGET_NAME}.entitlements",
    'CODE_SIGN_STYLE' => 'Automatic',
    'DEVELOPMENT_TEAM' => DEVELOPMENT_TEAM,
    'SWIFT_VERSION' => SWIFT_VERSION,
    'IPHONEOS_DEPLOYMENT_TARGET' => DEPLOYMENT_TARGET,
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'CURRENT_PROJECT_VERSION' => '1',
    'MARKETING_VERSION' => '1.0.1',
    'SKIP_INSTALL' => 'YES',
    'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks',
    'ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES' => 'YES',
    'CLANG_ENABLE_MODULES' => 'YES',
  )
end

# 3. Create a group for the extension's source files in the project navigator.
group = project.main_group.find_subpath(GROUP_NAME, true)
group.set_source_tree('<group>')
group.set_path(GROUP_NAME)

# 4. Add Swift sources, Info.plist, and entitlements to the group.
swift_file = group.new_reference('KeyboardViewController.swift')
info_file = group.new_reference('Info.plist')
ent_file = group.new_reference("#{TARGET_NAME}.entitlements")

# 5. Wire Swift source into the target's compile phase.
ext_target.add_file_references([swift_file])

# 6. Embed the extension into the main app.
embed_phase = main_target.copy_files_build_phases.find { |p| p.name == 'Embed App Extensions' }
unless embed_phase
  embed_phase = main_target.new_copy_files_build_phase('Embed App Extensions')
  embed_phase.symbol_dst_subfolder_spec = :plug_ins
end

product_ref = ext_target.product_reference
build_file = embed_phase.add_file_reference(product_ref)
build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

# 7. Make sure the main app builds the extension first.
main_target.add_dependency(ext_target)

# 8. Add TargetAttributes so Xcode signs/provisions the new target automatically.
project.root_object.attributes['TargetAttributes'] ||= {}
project.root_object.attributes['TargetAttributes'][ext_target.uuid] = {
  'CreatedOnToolsVersion' => '15.0',
  'DevelopmentTeam' => DEVELOPMENT_TEAM,
  'ProvisioningStyle' => 'Automatic',
}

project.save

puts "✓ Added target #{TARGET_NAME} (bundle id #{BUNDLE_ID})"
puts "✓ Embedded into main app's PlugIns"
puts "✓ App Group: #{APP_GROUP}"
