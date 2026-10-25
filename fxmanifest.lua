-- Modifying or rewriting this resource for local use only is strongly discouraged.
-- Feel free to open an issue or pull request in our GitHub.
-- Official discord server: https://discord.gg/hUM3pQeGFc

author('snipz')
description('sxPanel - A Replacement for txAdmin built on its source code.')
repository('https://github.com/Snipzil/sxpanel')
version 'REPLACE-VERSION'
ui_label 'sxPanel'
fx_version('cerulean')
game('common')
-- nui_callback_strict_mode 'true'
lua54 'yes'
node_version '22'

-- NOTE: All server_scripts will be executed both on monitor and server mode
-- NOTE: Due to global package constraints, js scripts will be loaded from entrypoint.js
-- NOTE: Script lists below are auto-generated at build time via fs.glob
shared_scripts({
    'resource/shared.lua',
    'resource/shared_weapons.lua',
})

server_scripts({
    'entrypoint.js',
    'resource/sv_main.lua', --must run first
    'resource/sv_admins.lua',
    'resource/sv_combatlog.lua',
    'resource/sv_logger.lua',
    'resource/sv_resources.lua',
    'resource/sv_playerlist.lua',
    'resource/sv_ctx.lua',
    'resource/sv_initialData.lua',
    'resource/sv_tickets.lua',
    'resource/sv_custom_commands.lua',
    'resource/menu/server/sv_webpipe.lua',
    'resource/menu/server/sv_functions.lua',
    'resource/menu/server/sv_main_page.lua',
    'resource/menu/server/sv_vehicle.lua',
    'resource/menu/server/sv_freeze_player.lua',
    'resource/menu/server/sv_trollactions.lua',
    'resource/menu/server/sv_player_modal.lua',
    'resource/menu/server/sv_spectate.lua',
    'resource/menu/server/sv_player_mode.lua',
    'resource/menu/server/sv_staff_tools.lua',
    'addons/live-map/resource/sv_positions.lua',
})

client_scripts({
    'resource/cl_main.lua',
    'resource/cl_screenshot.lua',
    'resource/cl_spectate_stream.lua',
    'resource/cl_logger.lua',
    'resource/cl_playerlist.lua',
    'resource/menu/client/cl_webpipe.lua',
    'resource/menu/client/cl_base.lua',
    'resource/menu/client/cl_functions.lua',
    'resource/cl_tickets.lua',
    'resource/cl_custom_commands.lua',
    'resource/menu/client/cl_instructional_ui.lua',
    'resource/menu/client/cl_main_page.lua',
    'resource/menu/client/cl_vehicle.lua',
    'resource/menu/client/cl_player_ids.lua',
    'resource/menu/client/cl_map_blips.lua',
    'resource/menu/client/cl_ptfx.lua', --must run before cl_player_mode
    'resource/menu/client/cl_player_mode.lua',
    'resource/menu/client/cl_spectate.lua',
    'resource/menu/client/cl_trollactions.lua',
    'resource/menu/client/cl_freeze.lua',
    'resource/menu/client/cl_staff_tools.lua',
    'resource/menu/vendor/freecam/utils.lua',
    'resource/menu/vendor/freecam/config.lua',
    'resource/menu/vendor/freecam/main.lua',
    'resource/menu/vendor/freecam/camera.lua',
})

-- Cache-bust query prevents FiveM's CEF from serving stale NUI files.
-- Bump the version whenever dist/nui content changes.
ui_page 'nui/index.html?v=7'

files {
    'locale/*.json',
    'nui/*',
    'nui/**/*',

    -- Addon NUI/static assets:
    'addons/*',
    'addons/**/*',

    -- WebPipe optimization:
    'panel/*',
    'panel/**/*',
}
