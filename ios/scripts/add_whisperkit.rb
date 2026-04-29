#!/usr/bin/env ruby
# Adds WhisperKit Swift Package + the bundled Models/ folder to the LittleAIKeyboard target.
# Idempotent.

require 'xcodeproj'

PROJECT_PATH = File.expand_path('../littleai.xcodeproj', __dir__)
TARGET_NAME = 'LittleAIKeyboard'
PACKAGE_URL = 'https://github.com/argmaxinc/WhisperKit'
PACKAGE_VERSION = '0.13.0'
PRODUCT_NAME = 'WhisperKit'
GROUP_NAME = 'LittleAIKeyboard'
MODELS_FOLDER_NAME = 'Models'

project = Xcodeproj::Project.open(PROJECT_PATH)
target = project.targets.find { |t| t.name == TARGET_NAME } or abort("target #{TARGET_NAME} not found")

# 1. Add or reuse the remote Swift package reference.
pkg_ref = project.root_object.package_references.find { |r| r.repositoryURL == PACKAGE_URL }
unless pkg_ref
  pkg_ref = project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
  pkg_ref.repositoryURL = PACKAGE_URL
  pkg_ref.requirement = { 'kind' => 'upToNextMajorVersion', 'minimumVersion' => PACKAGE_VERSION }
  project.root_object.package_references << pkg_ref
  puts "✓ Added Swift package #{PACKAGE_URL} (>= #{PACKAGE_VERSION})"
end

# 2. Wire the WhisperKit product into the target.
existing_dep = target.package_product_dependencies.find { |d| d.product_name == PRODUCT_NAME }
unless existing_dep
  product_dep = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
  product_dep.package = pkg_ref
  product_dep.product_name = PRODUCT_NAME
  target.package_product_dependencies << product_dep

  build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  build_file.product_ref = product_dep
  target.frameworks_build_phase.files << build_file
  puts "✓ Linked #{PRODUCT_NAME} into #{TARGET_NAME}"
end

# 3. Add Models/ as a folder reference so .mlmodelc subfolders ship intact.
group = project.main_group.find_subpath(GROUP_NAME, false)
abort("group #{GROUP_NAME} not found") unless group

folder_ref = group.files.find { |f| f.path == MODELS_FOLDER_NAME }
unless folder_ref
  folder_ref = group.new_file(MODELS_FOLDER_NAME, :group)
  # Make it a folder reference (blue folder), not a group, so contents copy verbatim.
  folder_ref.last_known_file_type = 'folder'
  folder_ref.set_source_tree('<group>')
  folder_ref.set_path(MODELS_FOLDER_NAME)
  puts "✓ Added folder reference #{MODELS_FOLDER_NAME}"
end

resources_phase = target.resources_build_phase
unless resources_phase.files.any? { |f| f.file_ref == folder_ref }
  resources_phase.add_file_reference(folder_ref)
  puts "✓ Added #{MODELS_FOLDER_NAME} to #{TARGET_NAME} resources build phase"
end

project.save
puts 'Done.'
