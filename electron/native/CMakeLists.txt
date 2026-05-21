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

endif()

# ============================================================
# NDI (NewTek Network Device Interface) — cross-platform.
# Detects either the "NDI Advanced SDK" or the regular NDI SDK
# at standard install paths. Builds ndi_addon.node when found;
# skips silently with a status message when not.
#
# Install instructions:
#   macOS: https://ndi.video/sdk → NDI Advanced SDK for Apple.
#          Installs to "/Library/NDI Advanced SDK for Apple".
#   Windows: NDI Advanced SDK installer →
#          "C:\\Program Files\\NDI\\NDI Advanced SDK".
#   Linux: Self-extracting installer → /opt/.
# ============================================================
set(NDI_FOUND FALSE)
set(NDI_INCLUDE_DIRS "")
set(NDI_LIBRARY "")

if(APPLE)
    foreach(candidate
        "/Library/NDI Advanced SDK for Apple"
        "/Library/NDI SDK for Apple"
    )
        if(EXISTS "${candidate}/include/Processing.NDI.Lib.h"
           AND EXISTS "${candidate}/lib/macOS/libndi.dylib")
            set(NDI_INCLUDE_DIRS "${candidate}/include")
            set(NDI_LIBRARY "${candidate}/lib/macOS/libndi.dylib")
            set(NDI_FOUND TRUE)
            break()
        endif()
    endforeach()
elseif(WIN32)
    foreach(candidate
        "C:/Program Files/NDI/NDI Advanced SDK"
        "C:/Program Files/NDI/NDI SDK"
        "C:/Program Files/NewTek/NDI SDK"
    )
        if(EXISTS "${candidate}/Include/Processing.NDI.Lib.h"
           AND EXISTS "${candidate}/Lib/x64/Processing.NDI.Lib.x64.lib")
            set(NDI_INCLUDE_DIRS "${candidate}/Include")
            set(NDI_LIBRARY "${candidate}/Lib/x64/Processing.NDI.Lib.x64.lib")
            set(NDI_FOUND TRUE)
            break()
        endif()
    endforeach()
elseif(UNIX)
    foreach(candidate "/opt/NDI Advanced SDK for Linux" "/opt/NDI SDK for Linux")
        if(EXISTS "${candidate}/include/Processing.NDI.Lib.h"
           AND EXISTS "${candidate}/lib/x86_64-linux-gnu/libndi.so")
            set(NDI_INCLUDE_DIRS "${candidate}/include")
            set(NDI_LIBRARY "${candidate}/lib/x86_64-linux-gnu/libndi.so")
            set(NDI_FOUND TRUE)
            break()
        endif()
    endforeach()
endif()

if(NDI_FOUND)
    message(STATUS "NDI SDK found — building ndi_addon.node")
    message(STATUS "  include: ${NDI_INCLUDE_DIRS}")
    message(STATUS "  library: ${NDI_LIBRARY}")

    add_library(ndi_addon SHARED
        ndi_addon.cpp
        ${CMAKE_JS_SRC}
    )
    target_include_directories(ndi_addon PRIVATE
        ${NDI_INCLUDE_DIRS}
        ${CMAKE_JS_INC}
        ${NODE_ADDON_API_DIR}
    )
    target_link_libraries(ndi_addon PRIVATE
        ${CMAKE_JS_LIB}
        ${NDI_LIBRARY}
    )
    target_compile_definitions(ndi_addon PRIVATE
        NAPI_VERSION=9
        NODE_ADDON_API_DISABLE_DEPRECATED
    )
    set_target_properties(ndi_addon PROPERTIES
        PREFIX ""
        SUFFIX ".node"
        CXX_STANDARD 17
    )

    if(APPLE)
        # libndi.dylib's install_name points at the SDK install path.
        # Same pattern as the Syphon framework: rewrite to @rpath and
        # add search paths so the addon resolves the dylib both in
        # dev (SDK install) and in a packaged .app (electron-builder
        # ships the dylib in Contents/Frameworks/).
        set_target_properties(ndi_addon PROPERTIES
            BUILD_WITH_INSTALL_RPATH TRUE
            INSTALL_RPATH "/Library/NDI Advanced SDK for Apple/lib/macOS;/Library/NDI SDK for Apple/lib/macOS;@loader_path/../../../../../../Frameworks;@loader_path"
        )
        # Copy libndi.dylib into the build output dir so electron-builder
        # can pick it up with a single relative path. Without this step
        # the SDK install path would have to be exposed to electron-
        # builder which varies between dev machines and CI runners.
        add_custom_command(TARGET ndi_addon POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${NDI_LIBRARY}"
                "$<TARGET_FILE_DIR:ndi_addon>/libndi.dylib"
            COMMAND install_name_tool -id "@rpath/libndi.dylib"
                "$<TARGET_FILE_DIR:ndi_addon>/libndi.dylib" || true
            COMMAND install_name_tool -change
                "${NDI_LIBRARY}"
                "@rpath/libndi.dylib"
                "$<TARGET_FILE:ndi_addon>" || true
            COMMAND codesign --force --sign - "$<TARGET_FILE_DIR:ndi_addon>/libndi.dylib" || true
            COMMAND codesign --force --sign - "$<TARGET_FILE:ndi_addon>" || true
            COMMENT "Bundling libndi.dylib + re-signing ad-hoc for Apple Silicon"
        )
    elseif(WIN32)
        # Copy Processing.NDI.Lib.x64.dll next to the .node so Windows'
        # DLL search resolves it from the loading binary's directory.
        # electron-builder ships the build/Release/ dir as-is via asarUnpack.
        set(NDI_DLL "${NDI_INCLUDE_DIRS}/../Bin/x64/Processing.NDI.Lib.x64.dll")
        if(EXISTS "${NDI_DLL}")
            add_custom_command(TARGET ndi_addon POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${NDI_DLL}"
                    "$<TARGET_FILE_DIR:ndi_addon>/Processing.NDI.Lib.x64.dll"
                COMMENT "Bundling Processing.NDI.Lib.x64.dll alongside ndi_addon.node"
            )
        else()
            message(WARNING "NDI runtime DLL not found at ${NDI_DLL} — built ndi_addon will fail to load at runtime")
        endif()
    endif()
else()
    message(STATUS
        "NDI SDK not found at standard paths — skipping ndi_addon build. "
        "Install the NDI Advanced SDK from https://ndi.video/sdk to enable.")

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
