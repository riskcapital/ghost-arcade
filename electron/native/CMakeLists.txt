cmake_minimum_required(VERSION 3.15)
project(texture_share_addon)

# Node.js addon setup via cmake-js
include_directories(${CMAKE_JS_INC})

# node-addon-api (napi.h) -- resolve from node_modules
execute_process(COMMAND node -p "require('node-addon-api').include"
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})

# ============================================================
# Platform-specific: Spout (Windows) or Syphon (macOS)
# ============================================================

if(WIN32)
    # --- WINDOWS: SpoutDX ---
    set(ADDON_NAME "spout_addon")

    set(SPOUT_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/vendor/SPOUTSDK")

    set(SPOUT_SOURCES
        ${SPOUT_SDK_DIR}/SpoutDirectX/SpoutDX/SpoutDX.cpp
        ${SPOUT_SDK_DIR}/SpoutGL/SpoutCopy.cpp
        ${SPOUT_SDK_DIR}/SpoutGL/SpoutDirectX.cpp
        ${SPOUT_SDK_DIR}/SpoutGL/SpoutFrameCount.cpp
        ${SPOUT_SDK_DIR}/SpoutGL/SpoutSenderNames.cpp
        ${SPOUT_SDK_DIR}/SpoutGL/SpoutSharedMemory.cpp
        ${SPOUT_SDK_DIR}/SpoutGL/SpoutUtils.cpp
    )

    add_library(${ADDON_NAME} SHARED
        spout_addon.cpp
        ${SPOUT_SOURCES}
        ${CMAKE_JS_SRC}
    )

    target_include_directories(${ADDON_NAME} PRIVATE
        ${SPOUT_SDK_DIR}/SpoutDirectX/SpoutDX
        ${SPOUT_SDK_DIR}/SpoutGL
        ${CMAKE_JS_INC}
        ${NODE_ADDON_API_DIR}
    )

    target_link_libraries(${ADDON_NAME} PRIVATE
        ${CMAKE_JS_LIB}
        d3d11
        dxgi
        dxguid
        delayimp
    )

    if(MSVC)
        target_compile_options(${ADDON_NAME} PRIVATE /W0)
        set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreadedDLL")
    endif()

    target_compile_definitions(${ADDON_NAME} PRIVATE
        UNICODE
        _UNICODE
        NAPI_VERSION=9
        NODE_ADDON_API_DISABLE_DEPRECATED
    )

    set_target_properties(${ADDON_NAME} PROPERTIES
        PREFIX ""
        SUFFIX ".node"
        CXX_STANDARD 17
    )

elseif(APPLE)
    # --- macOS: Syphon ---
    set(ADDON_NAME "syphon_addon")

    add_library(${ADDON_NAME} SHARED
        syphon_addon.mm
        ${CMAKE_JS_SRC}
    )

    target_include_directories(${ADDON_NAME} PRIVATE
        ${CMAKE_JS_INC}
        ${NODE_ADDON_API_DIR}
    )

    # Link Syphon framework + system frameworks
    find_library(SYPHON_FRAMEWORK Syphon PATHS /Library/Frameworks ~/Library/Frameworks)
    find_library(COCOA_FRAMEWORK Cocoa)
    find_library(OPENGL_FRAMEWORK OpenGL)

    if(NOT SYPHON_FRAMEWORK)
        # syphon_addon.mm #imports <Syphon/Syphon.h> unconditionally, so a "stub
        # build" without the framework can't even compile — the prior WARNING
        # path was misleading. Fail the build with install instructions instead.
        message(FATAL_ERROR
            "Syphon.framework not found in /Library/Frameworks or ~/Library/Frameworks.\n"
            "Install it before building:\n"
            "  1. Download Syphon SDK 5: https://github.com/Syphon/Syphon-Framework/releases\n"
            "  2. Copy Syphon.framework to /Library/Frameworks/\n"
            "     sudo cp -R 'Syphon SDK 5/Syphon.framework' /Library/Frameworks/\n"
            "  3. Re-run the build.")
    endif()

    target_link_libraries(${ADDON_NAME} PRIVATE
        ${CMAKE_JS_LIB}
        ${SYPHON_FRAMEWORK}
        ${COCOA_FRAMEWORK}
        ${OPENGL_FRAMEWORK}
    )

    target_compile_definitions(${ADDON_NAME} PRIVATE
        NAPI_VERSION=9
        NODE_ADDON_API_DISABLE_DEPRECATED
    )

    set_target_properties(${ADDON_NAME} PROPERTIES
        PREFIX ""
        SUFFIX ".node"
        CXX_STANDARD 17
    )

    # Enable Objective-C++ for .mm files
    set_source_files_properties(syphon_addon.mm PROPERTIES
        COMPILE_FLAGS "-x objective-c++ -fobjc-arc"
    )

    # Syphon.framework has an install_name of
    #   @loader_path/../Frameworks/Syphon.framework/Versions/A/Syphon
    # which is baked in for bundled use inside a packaged .app
    # (Contents/Frameworks/...). For our .node the relative lookup lands on
    # electron/native/build/Frameworks/ which doesn't exist, so dlopen fails.
    #
    # Rewrite that reference to @rpath and give the .node two rpath search
    # locations:
    #   1. /Library/Frameworks — where a user installs Syphon for dev
    #   2. @loader_path/../../../../../../Frameworks — where electron-builder
    #      places Frameworks inside the packaged .app, relative to the .node's
    #      location at Contents/Resources/app.asar.unpacked/electron/native/build/Release/
    #
    # install_name_tool invalidates the code signature on arm64 (required on
    # Apple Silicon), so re-sign ad-hoc afterwards. Silent-fail the codesign
    # on systems where it's not needed.
    set_target_properties(${ADDON_NAME} PROPERTIES
        BUILD_WITH_INSTALL_RPATH TRUE
        INSTALL_RPATH "/Library/Frameworks;@loader_path/../../../../../../Frameworks"
    )
    add_custom_command(TARGET ${ADDON_NAME} POST_BUILD
        COMMAND install_name_tool -change
            "@loader_path/../Frameworks/Syphon.framework/Versions/A/Syphon"
            "@rpath/Syphon.framework/Versions/A/Syphon"
            "$<TARGET_FILE:${ADDON_NAME}>"
        COMMAND codesign --force --sign - "$<TARGET_FILE:${ADDON_NAME}>" || true
        COMMENT "Rewriting Syphon install_name to @rpath + re-signing for Apple Silicon"
    )

endif()
