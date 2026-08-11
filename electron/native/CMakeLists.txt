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

    # --- WINDOWS: embedded native preview presenter (DXGI twin of
    # native_preview_addon.mm). Presents the render core's named D3D12 shared
    # texture into a child HWND parented to the Electron window.
    add_library(dxgi_preview_addon SHARED
        dxgi_preview_addon.cpp
        ${CMAKE_JS_SRC}
    )

    target_include_directories(dxgi_preview_addon PRIVATE
        ${CMAKE_JS_INC}
        ${NODE_ADDON_API_DIR}
    )

    target_link_libraries(dxgi_preview_addon PRIVATE
        ${CMAKE_JS_LIB}
        d3d11
        dxgi
        dxguid
    )

    if(MSVC)
        target_compile_options(dxgi_preview_addon PRIVATE /W0)
    endif()

    target_compile_definitions(dxgi_preview_addon PRIVATE
        UNICODE
        _UNICODE
        NAPI_VERSION=9
        NODE_ADDON_API_DISABLE_DEPRECATED
    )

    set_target_properties(dxgi_preview_addon PROPERTIES
        PREFIX ""
        SUFFIX ".node"
        CXX_STANDARD 17
    )

    # --- WINDOWS: native live capture (webcam via Media Foundation, screen
    # via DXGI Desktop Duplication). DXGI twin of live_capture_addon.mm —
    # returns a shared D3D11 texture HANDLE that the broker duplicates into
    # the render-core process.
    add_library(win_capture_addon SHARED
        win_capture_addon.cpp
        ${CMAKE_JS_SRC}
    )
    target_include_directories(win_capture_addon PRIVATE
        ${CMAKE_JS_INC}
        ${NODE_ADDON_API_DIR}
    )
    target_link_libraries(win_capture_addon PRIVATE
        ${CMAKE_JS_LIB}
        d3d11
        dxgi
        dxguid
        mf
        mfplat
        mfreadwrite
        mfuuid
        ole32
        # Windows.Graphics.Capture (C++/WinRT) — screen + per-window capture.
        WindowsApp
    )
    if(MSVC)
        target_compile_options(win_capture_addon PRIVATE /W0)
    endif()
    target_compile_definitions(win_capture_addon PRIVATE
        UNICODE
        _UNICODE
        NAPI_VERSION=9
        NODE_ADDON_API_DISABLE_DEPRECATED
    )
    set_target_properties(win_capture_addon PROPERTIES
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

    # Link Syphon framework + system frameworks. Prefer a vendored framework
    # committed/copied under electron/native/vendor/ so CI/release builds do
    # not depend on a machine-global /Library install; keep the user Frameworks
    # paths for local development.
    set(SYPHON_FRAMEWORK_SEARCH_PATHS
        "${CMAKE_CURRENT_SOURCE_DIR}/vendor"
        "${CMAKE_CURRENT_SOURCE_DIR}/vendor/Syphon"
        "/Library/Frameworks"
        "$ENV{HOME}/Library/Frameworks"
    )
    find_path(SYPHON_FRAMEWORK_PARENT
        NAMES Syphon.framework
        PATHS ${SYPHON_FRAMEWORK_SEARCH_PATHS}
        NO_DEFAULT_PATH
    )
    if(SYPHON_FRAMEWORK_PARENT)
        set(SYPHON_FRAMEWORK "${SYPHON_FRAMEWORK_PARENT}/Syphon.framework")
    endif()
    find_library(COCOA_FRAMEWORK Cocoa)
    find_library(OPENGL_FRAMEWORK OpenGL)

    if(NOT SYPHON_FRAMEWORK)
        # syphon_addon.mm #imports <Syphon/Syphon.h> unconditionally, so a "stub
        # build" without the framework can't even compile — the prior WARNING
        # path was misleading. Fail the build with install instructions instead.
        message(FATAL_ERROR
            "Syphon.framework not found.\n"
            "Release builds must vendor a universal arm64+x86_64 framework so the .app ships self-contained:\n"
            "  1. Build Syphon.framework from https://github.com/Syphon/Syphon-Framework tag 5\n"
            "     (the prebuilt SDK 5 framework is x86_64-only)\n"
            "  2. Copy the universal framework to electron/native/vendor/Syphon.framework\n"
            "     (local dev can also use ~/Library/Frameworks or /Library/Frameworks)\n"
            "  3. Re-run the build.")
    endif()
    message(STATUS "Syphon.framework found: ${SYPHON_FRAMEWORK}")

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
    #   2. @loader_path — local dev build output, where POST_BUILD stages a
    #      copy next to syphon_addon.node
    #   3. @loader_path/../../../../../../Frameworks — where electron-builder
    #      places Frameworks inside the packaged .app, relative to the .node's
    #      location at Contents/Resources/app.asar.unpacked/electron/native/build/Release/
    #
    # install_name_tool invalidates the code signature on arm64 (required on
    # Apple Silicon), so re-sign ad-hoc afterwards. Silent-fail the codesign
    # on systems where it's not needed.
    set_target_properties(${ADDON_NAME} PROPERTIES
        BUILD_WITH_INSTALL_RPATH TRUE
        INSTALL_RPATH "/Library/Frameworks;@loader_path;@loader_path/../../../../../../Frameworks"
    )
    add_custom_command(TARGET ${ADDON_NAME} POST_BUILD
        COMMAND install_name_tool -change
            "@loader_path/../Frameworks/Syphon.framework/Versions/A/Syphon"
            "@rpath/Syphon.framework/Versions/A/Syphon"
            "$<TARGET_FILE:${ADDON_NAME}>"
        COMMAND ${CMAKE_COMMAND} -E copy_directory
            "${SYPHON_FRAMEWORK}"
            "$<TARGET_FILE_DIR:${ADDON_NAME}>/Syphon.framework"
        COMMAND codesign --force --sign - "$<TARGET_FILE:${ADDON_NAME}>" || true
        COMMENT "Rewriting Syphon install_name to @rpath, staging Syphon.framework, and re-signing for Apple Silicon"
    )

    # --- macOS: embedded native editor preview presenter ---
    add_library(native_preview_addon SHARED
        native_preview_addon.mm
        ${CMAKE_JS_SRC}
    )

    find_library(QUARTZCORE_FRAMEWORK QuartzCore)
    find_library(METAL_FRAMEWORK Metal)
    find_library(IOSURFACE_FRAMEWORK IOSurface)
    find_library(COREVIDEO_FRAMEWORK CoreVideo)

    target_include_directories(native_preview_addon PRIVATE
        ${CMAKE_JS_INC}
        ${NODE_ADDON_API_DIR}
    )

    target_link_libraries(native_preview_addon PRIVATE
        ${CMAKE_JS_LIB}
        ${COCOA_FRAMEWORK}
        ${QUARTZCORE_FRAMEWORK}
        ${METAL_FRAMEWORK}
        ${IOSURFACE_FRAMEWORK}
        ${COREVIDEO_FRAMEWORK}
    )

    target_compile_definitions(native_preview_addon PRIVATE
        NAPI_VERSION=9
        NODE_ADDON_API_DISABLE_DEPRECATED
    )

    set_target_properties(native_preview_addon PROPERTIES
        PREFIX ""
        SUFFIX ".node"
        CXX_STANDARD 17
    )

    set_source_files_properties(native_preview_addon.mm PROPERTIES
        COMPILE_FLAGS "-x objective-c++ -fobjc-arc"
    )

    add_custom_command(TARGET native_preview_addon POST_BUILD
        COMMAND codesign --force --sign - "$<TARGET_FILE:native_preview_addon>" || true
        COMMENT "Re-signing native_preview_addon for Apple Silicon"
    )

    # --- macOS: native webcam + ScreenCaptureKit source acquisition ---
    add_library(live_capture_addon SHARED
        live_capture_addon.mm
        ${CMAKE_JS_SRC}
    )

    find_library(AVFOUNDATION_FRAMEWORK AVFoundation)
    find_library(COREMEDIA_FRAMEWORK CoreMedia)
    find_library(SCREENCAPTUREKIT_FRAMEWORK ScreenCaptureKit)

    target_include_directories(live_capture_addon PRIVATE
        ${CMAKE_JS_INC}
        ${NODE_ADDON_API_DIR}
    )

    target_link_libraries(live_capture_addon PRIVATE
        ${CMAKE_JS_LIB}
        ${COCOA_FRAMEWORK}
        ${AVFOUNDATION_FRAMEWORK}
        ${COREMEDIA_FRAMEWORK}
        ${COREVIDEO_FRAMEWORK}
        ${IOSURFACE_FRAMEWORK}
        ${METAL_FRAMEWORK}
        ${SCREENCAPTUREKIT_FRAMEWORK}
    )

    target_compile_definitions(live_capture_addon PRIVATE
        NAPI_VERSION=9
        NODE_ADDON_API_DISABLE_DEPRECATED
    )

    set_target_properties(live_capture_addon PROPERTIES
        PREFIX ""
        SUFFIX ".node"
        CXX_STANDARD 17
    )

    set_source_files_properties(live_capture_addon.mm PROPERTIES
        COMPILE_FLAGS "-x objective-c++ -fobjc-arc"
    )

    add_custom_command(TARGET live_capture_addon POST_BUILD
        COMMAND codesign --force --sign - "$<TARGET_FILE:live_capture_addon>" || true
        COMMENT "Re-signing live_capture_addon for Apple Silicon"
    )

endif()

# ============================================================
# Ableton Link — cross-platform tempo/beat sync over the LAN.
# Header-only (vendored at vendor/link + standalone asio). Built
# whenever the vendor directory is present. GPLv2 — commercial
# distribution requires Ableton's no-cost Link license (requested via
# link-devs@ableton.com); see docs/time-sync-review-2026-06.md.
# ============================================================
set(LINK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/vendor/link")
if(EXISTS "${LINK_DIR}/include/ableton/Link.hpp")
    message(STATUS "Ableton Link vendored — building link_addon.node")
    add_library(link_addon SHARED
        link_addon.cpp
        ${CMAKE_JS_SRC}
    )
    target_include_directories(link_addon PRIVATE
        ${LINK_DIR}/include
        ${LINK_DIR}/modules/asio-standalone/asio/include
        ${CMAKE_JS_INC}
        ${NODE_ADDON_API_DIR}
    )
    target_link_libraries(link_addon PRIVATE ${CMAKE_JS_LIB})
    target_compile_definitions(link_addon PRIVATE
        NAPI_VERSION=9
        NODE_ADDON_API_DISABLE_DEPRECATED
        ASIO_STANDALONE
    )
    if(WIN32)
        target_compile_definitions(link_addon PRIVATE
            LINK_PLATFORM_WINDOWS=1
            _WIN32_WINNT=0x0601
            NOMINMAX
            WIN32_LEAN_AND_MEAN
        )
        target_link_libraries(link_addon PRIVATE ws2_32 iphlpapi winmm)
        if(MSVC)
            target_compile_options(link_addon PRIVATE /W0 /EHsc)
        endif()
    elseif(APPLE)
        target_compile_definitions(link_addon PRIVATE LINK_PLATFORM_MACOSX=1)
    elseif(UNIX)
        target_compile_definitions(link_addon PRIVATE LINK_PLATFORM_LINUX=1)
    endif()
    set_target_properties(link_addon PROPERTIES
        PREFIX ""
        SUFFIX ".node"
        CXX_STANDARD 17
    )
else()
    message(STATUS "Ableton Link vendor not found at ${LINK_DIR} — skipping link_addon build.")
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
set(NDI_SDK_CANDIDATES "")

if(DEFINED ENV{NDI_SDK_DIR} AND NOT "$ENV{NDI_SDK_DIR}" STREQUAL "")
    file(TO_CMAKE_PATH "$ENV{NDI_SDK_DIR}" NDI_SDK_ENV_DIR)
    list(APPEND NDI_SDK_CANDIDATES "${NDI_SDK_ENV_DIR}")
endif()

if(APPLE)
    list(APPEND NDI_SDK_CANDIDATES
        "/Library/NDI Advanced SDK for Apple"
        "/Library/NDI SDK for Apple"
    )
    foreach(candidate ${NDI_SDK_CANDIDATES})
        if(EXISTS "${candidate}/include/Processing.NDI.Lib.h"
           AND EXISTS "${candidate}/lib/macOS/libndi.dylib")
            set(NDI_INCLUDE_DIRS "${candidate}/include")
            set(NDI_LIBRARY "${candidate}/lib/macOS/libndi.dylib")
            set(NDI_FOUND TRUE)
            break()
        endif()
    endforeach()
elseif(WIN32)
    list(APPEND NDI_SDK_CANDIDATES
        "C:/Program Files/NDI/NDI Advanced SDK"
        "C:/Program Files/NDI/NDI SDK"
        "C:/Program Files/NewTek/NDI SDK"
    )
    foreach(candidate ${NDI_SDK_CANDIDATES})
        if(EXISTS "${candidate}/Include/Processing.NDI.Lib.h"
           AND EXISTS "${candidate}/Lib/x64/Processing.NDI.Lib.x64.lib")
            set(NDI_INCLUDE_DIRS "${candidate}/Include")
            set(NDI_LIBRARY "${candidate}/Lib/x64/Processing.NDI.Lib.x64.lib")
            set(NDI_FOUND TRUE)
            break()
        endif()
    endforeach()
elseif(UNIX)
    list(APPEND NDI_SDK_CANDIDATES
        "/opt/NDI Advanced SDK for Linux"
        "/opt/NDI SDK for Linux"
    )
    foreach(candidate ${NDI_SDK_CANDIDATES})
        file(GLOB NDI_LINUX_LIB_CANDIDATES
            "${candidate}/lib/x86_64-linux-gnu/libndi.so"
            "${candidate}/lib/x86_64-linux-gnu/libndi.so.*"
        )
        list(SORT NDI_LINUX_LIB_CANDIDATES)
        if(EXISTS "${candidate}/include/Processing.NDI.Lib.h"
           AND NDI_LINUX_LIB_CANDIDATES)
            list(GET NDI_LINUX_LIB_CANDIDATES 0 NDI_LINUX_LIB)
            set(NDI_INCLUDE_DIRS "${candidate}/include")
            set(NDI_LIBRARY "${NDI_LINUX_LIB}")
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
        target_link_libraries(ndi_addon PRIVATE
            "-framework CoreFoundation"
            "-framework IOSurface"
        )
        # libndi.dylib's install_name points at the SDK install path.
        # Rewrite to @rpath for local developer testing. Release packaging
        # excludes NDI runtime binaries unless we replace this with a proper
        # dynamic-loader bridge.
        set_target_properties(ndi_addon PROPERTIES
            BUILD_WITH_INSTALL_RPATH TRUE
            INSTALL_RPATH "/Library/NDI Advanced SDK for Apple/lib/macOS;/Library/NDI SDK for Apple/lib/macOS;@loader_path/../../../../../../Frameworks;@loader_path"
        )
        # Stage a local runtime copy for developer testing. electron-builder
        # excludes libndi.* from public installers.
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
            COMMENT "Staging libndi.dylib for local NDI testing and re-signing ad-hoc for Apple Silicon"
        )
    elseif(WIN32)
        # Stage a local runtime copy for developer testing. electron-builder
        # excludes Processing.NDI.Lib*.dll from public installers.
        set(NDI_DLL "${NDI_INCLUDE_DIRS}/../Bin/x64/Processing.NDI.Lib.x64.dll")
        if(EXISTS "${NDI_DLL}")
            add_custom_command(TARGET ndi_addon POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "${NDI_DLL}"
                    "$<TARGET_FILE_DIR:ndi_addon>/Processing.NDI.Lib.x64.dll"
                COMMENT "Staging Processing.NDI.Lib.x64.dll alongside ndi_addon.node for local NDI testing"
            )
        else()
            message(WARNING "NDI runtime DLL not found at ${NDI_DLL} — built ndi_addon will fail to load at runtime")
        endif()
    elseif(UNIX)
        set_target_properties(ndi_addon PROPERTIES
            BUILD_WITH_INSTALL_RPATH TRUE
            INSTALL_RPATH "$ORIGIN"
        )
        add_custom_command(TARGET ndi_addon POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${NDI_LIBRARY}"
                "$<TARGET_FILE_DIR:ndi_addon>/libndi.so"
            COMMENT "Staging libndi.so alongside ndi_addon.node for local NDI testing"
        )
    endif()
else()
    message(STATUS
        "NDI SDK not found at standard paths — skipping ndi_addon build. "
        "Install the NDI Advanced SDK from https://ndi.video/sdk to enable.")
endif()
