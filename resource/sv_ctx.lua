-- Prevent running in monitor mode
if not TX_SERVER_MODE then
    return
end

--NOTE: although quite a lot of this is used on the menu, this must run even if the menu is disabled
--because the locale applies to warns and notifications, as well as notification position

local ServerCtxObj = {
    oneSync = {
        type = nil,
        status = false,
    },
    projectName = nil,
    maxClients = 30,
    locale = nil,
    localeData = nil,
    instructionalLabels = nil,
    switchPageKey = '',
    sxPanelVersion = '',
    alignRight = false,
    announceNotiPos = '', -- top-center, top-right, top-left, bottom-center, bottom-right, bottom-left
    tagDefinitions = {},
    reportsEnabled = false,
}

local function getCustomLocaleData()
    local fileData = LoadResourceFile(TX_RESOURCE_NAME, '.runtime/locale.json')
    if type(fileData) ~= 'string' then
        TxPrint("^1WARNING: failed to load custom 'locale.json' file.")
        return false
    end

    -- Parse and validate data
    local locale = json.decode(fileData)
    if
        not locale
        or type(locale['$meta']) ~= 'table'
        or type(locale['nui_warning']) ~= 'table'
        or type(locale['nui_menu']) ~= 'table'
    then
        TxPrint('^1WARNING: failed to validate custom locale JSON.')
        return false
    end

    -- Build response
    DebugPrint('^2Loaded custom locale file.')
    local out = {
        ['$meta'] = locale['$meta'],
        ['nui_warning'] = locale['nui_warning'],
        ['nui_menu'] = locale['nui_menu'],
    }
    return out
end

local function extractInstructionalLabels(locale)
    if type(locale) ~= 'table' then return nil end
    local nuiMenu = locale['nui_menu']
    if type(nuiMenu) ~= 'table' then return nil end
    local instructional = nuiMenu['instructional']
    if type(instructional) ~= 'table' then return nil end
    return {
        exit_spectate = instructional['exit_spectate'],
        previous_player = instructional['previous_player'],
        next_player = instructional['next_player'],
        spectate_title = instructional['spectate_title'],
        noclip_slower = instructional['noclip_slower'],
        noclip_faster = instructional['noclip_faster'],
        noclip_fwd_back = instructional['noclip_fwd_back'],
        noclip_left_right = instructional['noclip_left_right'],
        noclip_title = instructional['noclip_title'],
        noclip_down = instructional['noclip_down'],
        noclip_up = instructional['noclip_up'],
        noclip_speed = instructional['noclip_speed'],
        noclip_speed_value = instructional['noclip_speed_value'],
    }
end

local function syncServerCtx()
    local oneSyncConvar = GetConvar('onesync', 'off')
    if oneSyncConvar == 'on' or oneSyncConvar == 'legacy' then
        ServerCtxObj.oneSync.type = oneSyncConvar
        ServerCtxObj.oneSync.status = true
    elseif oneSyncConvar == 'off' then
        ServerCtxObj.oneSync.type = nil
        ServerCtxObj.oneSync.status = false
    end

    -- Convar must match the event.code *EXACTLY* as shown on this site
    -- https://keycode.info/
    local switchPageKey = GetConvar('txAdmin-menuPageKey', 'Tab')
    ServerCtxObj.switchPageKey = switchPageKey

    local alignRight = GetConvarBool('txAdmin-menuAlignRight')
    ServerCtxObj.alignRight = alignRight

    local sxPanelVersion = GetConvar('txAdmin-version', '0.0.0')
    ServerCtxObj.sxPanelVersion = sxPanelVersion

    -- Default '' in fxServer
    -- Server list metadata moved to the Cfx Portal, so sv_projectname is often unset now;
    -- fall back to the server name configured in sxPanel.
    local svProjectName = GetConvar('sv_projectname', '')
    if svProjectName == '' then
        svProjectName = GetConvar('txAdmin-serverName', '')
    end
    ServerCtxObj.projectName = svProjectName ~= '' and svProjectName or nil

    -- Default 30 in fxServer
    local svMaxClients = GetConvarInt('sv_maxclients', 30)
    ServerCtxObj.maxClients = svMaxClients

    -- Custom locale
    local txAdminLocale = GetConvar('txAdmin-locale', 'en')
    ServerCtxObj.locale = txAdminLocale
    if txAdminLocale == 'custom' then
        ServerCtxObj.localeData = getCustomLocaleData()
        if ServerCtxObj.localeData then
            local customFile = LoadResourceFile(TX_RESOURCE_NAME, '.runtime/locale.json')
            if type(customFile) == 'string' then
                local customLocale = json.decode(customFile)
                ServerCtxObj.instructionalLabels = extractInstructionalLabels(customLocale)
            end
        end
    else
        -- Load the built-in locale file and send only NUI sections
        local localeFile = LoadResourceFile(TX_RESOURCE_NAME, 'locale/' .. txAdminLocale .. '.json')
        if type(localeFile) == 'string' then
            local locale = json.decode(localeFile)
            if locale and type(locale['$meta']) == 'table' then
                ServerCtxObj.localeData = {
                    ['$meta'] = locale['$meta'],
                    ['nui_warning'] = locale['nui_warning'],
                    ['nui_menu'] = locale['nui_menu'],
                }
                ServerCtxObj.instructionalLabels = extractInstructionalLabels(locale)
            else
                TxPrint('^1WARNING: failed to parse locale file for: ' .. txAdminLocale)
                ServerCtxObj.localeData = false
            end
        else
            TxPrint('^1WARNING: failed to load locale file for: ' .. txAdminLocale)
            ServerCtxObj.localeData = false
        end
    end

    local announceNotiPos = GetConvar('txAdmin-menuAnnounceNotiPos', 'top-center')
    -- verify we have a valid position type
    if
        announceNotiPos == 'top-center'
        or announceNotiPos == 'top-right'
        or announceNotiPos == 'top-left'
        or announceNotiPos == 'bottom-center'
        or announceNotiPos == 'bottom-right'
        or announceNotiPos == 'bottom-left'
    then
        ServerCtxObj.announceNotiPos = announceNotiPos
    else
        local errorMsg = ('^1Invalid notification position: %s, this must match one of the following "top-center, top-left, top-right, bottom-left, bottom-right, bottom-center" defaulting to "top-center"'):format(
            announceNotiPos
        )
        TxPrint(errorMsg)
        ServerCtxObj.announceNotiPos = 'top-center'
    end

    -- Tag definitions (auto + custom) from core config
    local tagDefsRaw = GetConvar('txAdmin-tagDefinitions', '[]')
    local tagDefs = json.decode(tagDefsRaw)
    if type(tagDefs) == 'table' then
        ServerCtxObj.tagDefinitions = tagDefs
    else
        ServerCtxObj.tagDefinitions = {}
    end

    -- Reports enabled flag
    ServerCtxObj.reportsEnabled = GetConvarBool('txAdmin-reportsEnabled')

    DebugPrint('Updated TX_SERVER_CTX.')
    GlobalState.txAdminServerCtx = ServerCtxObj

    -- Telling admins that the server context changed
    for adminID, _ in pairs(TX_ADMINS) do
        TriggerClientEvent('txcl:setServerCtx', adminID, ServerCtxObj)
    end
end

RegisterNetEvent('txsv:req:TX_SERVER_CTX', function()
    local src = source
    TriggerClientEvent('txcl:setServerCtx', src, ServerCtxObj)
end)

-- Everytime the txAdmin convars are changed this event will fire
-- Therefore, lets update global state with that.
AddEventHandler('txAdmin:events:configChanged', function()
    DebugPrint('configChanged event triggered, syncing GlobalState')
    syncServerCtx()
end)

CreateThread(function()
    -- If we don't wait for two ticks there is some race condition that
    -- sometimes prevents DebugPrint lmao
    Wait(0)
    syncServerCtx()
end)
