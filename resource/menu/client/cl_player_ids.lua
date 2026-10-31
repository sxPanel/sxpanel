-- Prevent running if menu is disabled
if not TX_MENU_ENABLED then
    return
end

-- =============================================
--  This file contains all overhead player ID logic
-- =============================================

-- Variables
local isPlayerIdsEnabled = false
local playerGamerTags = {}
local distanceToCheck = GetConvarInt('txAdmin-menuPlayerIdDistance', 150)

-- Game consts
local fivemGamerTagCompsEnum = {
    GamerName = 0,
    CrewTag = 1,
    HealthArmour = 2,
    BigText = 3,
    AudioIcon = 4,
    UsingMenu = 5,
    PassiveMode = 6,
    WantedStars = 7,
    Driver = 8,
    CoDriver = 9,
    Tagged = 12,
    GamerNameNearby = 13,
    Arrow = 14,
    Packages = 15,
    InvIfPedIsFollowing = 16,
    RankText = 17,
    Typing = 18,
}

local redmGamerTagCompsEnum = {
    none = 0,
    icon = 1,
    simple = 2,
    complex = 3,
}
local redmSpeakerIconHash = GetHashKey('SPEAKER')
local redmColorYellowHash = GetHashKey('COLOR_YELLOWSTRONG')

-- Tag display config: label prefix and HUD color index (FiveM)
-- See https://docs.fivem.net/docs/game-references/hud-colors/ for color indices
-- Auto-tag HUD color overrides (FiveM only supports palette indices, not hex)
local autoTagHudColors = {
    staff = 6,        -- HUD_COLOUR_RED
    problematic = 17, -- HUD_COLOUR_ORANGE
    newplayer = 12,   -- HUD_COLOUR_YELLOW (green-ish)
}
local defaultCustomHudColor = 4 -- HUD_COLOUR_BLUE for custom tags

local function refreshOverheadConvars()
    distanceToCheck = GetConvarInt('txAdmin-menuPlayerIdDistance', 150)
    if distanceToCheck < 1 then
        distanceToCheck = 150
    end
end
refreshOverheadConvars()

local function resolveTagPrefix(def)
    if type(def.prefix) == 'string' and def.prefix ~= '' then
        return def.prefix
    end
    if type(def.label) == 'string' and def.label ~= '' then
        return '[' .. string.upper(string.sub(def.label, 1, 1)) .. '] '
    end
    return ''
end

--- Builds the tag display config and priority list from TX_SERVER_CTX.tagDefinitions
local tagDisplayConfig = {}
local tagPriority = {}

local function rebuildTagConfig()
    local defs = (type(TX_SERVER_CTX) == 'table' and TX_SERVER_CTX.tagDefinitions) or {}
    local newConfig = {}
    local newPriority = {}

    if #defs > 0 then
        local sorted = {}
        for _, d in ipairs(defs) do
            if d.enabled ~= false then
                sorted[#sorted + 1] = d
            end
        end
        table.sort(sorted, function(a, b) return a.priority < b.priority end)

        for _, d in ipairs(sorted) do
            local hudColor = d.hudColor or autoTagHudColors[d.id] or defaultCustomHudColor
            newConfig[d.id] = { prefix = resolveTagPrefix(d), hudColor = hudColor }
            newPriority[#newPriority + 1] = d.id
        end
    else
        -- Fallback to hardcoded auto-tags
        newConfig = {
            staff = { prefix = '[S] ', hudColor = 6 },
            problematic = { prefix = '[!] ', hudColor = 17 },
            newplayer = { prefix = '[N] ', hudColor = 12 },
        }
        newPriority = { 'staff', 'problematic', 'newplayer' }
    end

    tagDisplayConfig = newConfig
    tagPriority = newPriority
end
rebuildTagConfig()

local function resolveTagPrefixForId(tagId)
    if type(tagId) ~= 'string' or tagId == '' then
        return ''
    end
    local cfg = tagDisplayConfig[tagId]
    if cfg and type(cfg.prefix) == 'string' and cfg.prefix ~= '' then
        return cfg.prefix
    end
    return '[' .. string.upper(string.sub(tagId, 1, 1)) .. '] '
end

local function formatDistanceStr(distanceM, isSelf)
    if isSelf then
        return '0m'
    end
    if distanceM < 0 then
        return '??m'
    end
    return tostring(distanceM) .. 'm'
end

local function buildPlayerLabel(tagPrefix, serverId, playerName, distStr)
    local suffix = '  ' .. distStr
    local maxNameLen = math.max(1, 75 - #suffix - #tagPrefix - #(' [' .. serverId .. ']'))
    local trimmedName = string.sub(playerName or 'unknown', 1, maxNameLen)
    return tagPrefix .. trimmedName .. ' [' .. serverId .. ']' .. suffix
end

--- Gets the highest-priority tag for a player from TX_LOCAL_PLAYERLIST
local function getPlayerTopTag(serverId)
    if type(TX_LOCAL_PLAYERLIST) ~= 'table' then
        return nil
    end
    local pidStr = tostring(serverId)
    local playerEntry = TX_LOCAL_PLAYERLIST[pidStr]
    if playerEntry == nil then return nil end
    local tags = playerEntry.tags
    if tags == nil and playerEntry.admin == true then
        return 'staff'
    end
    if tags == nil then return nil end
    -- Both lists are tiny, a nested loop avoids allocating a set every tick
    for _, p in ipairs(tagPriority) do
        for _, t in ipairs(tags) do
            if t == p then return p end
        end
    end
    return tags[1]
end

--- Removes all cached tags
local function cleanAllGamerTags()
    DebugPrint('Cleaning up gamer tags table')
    for _, v in pairs(playerGamerTags) do
        if IsMpGamerTagActive(v.gamerTag) then
            if IS_FIVEM then
                RemoveMpGamerTag(v.gamerTag)
            else
                Citizen.InvokeNative(0x839BFD7D7E49FE09, Citizen.PointerValueIntInitialized(v.gamerTag))
            end
        end
    end
    playerGamerTags = {}
end

--- Draws a single gamer tag (fivem)
local function setGamerTagFivem(targetTag, pid, cached)
    if cached and cached.label and type(SetMpGamerTagName) == 'function' then
        SetMpGamerTagName(targetTag, cached.label)
    end

    -- Setup name
    ---@diagnostic disable-next-line: param-type-mismatch
    SetMpGamerTagVisibility(targetTag, fivemGamerTagCompsEnum.GamerName, 1)

    -- Setup Health
    SetMpGamerTagHealthBarColor(targetTag, 129)
    SetMpGamerTagAlpha(targetTag, fivemGamerTagCompsEnum.HealthArmour, 255)
    ---@diagnostic disable-next-line: param-type-mismatch
    SetMpGamerTagVisibility(targetTag, fivemGamerTagCompsEnum.HealthArmour, 1)

    -- Determine name color based on tag or talking state
    local topTag = cached and cached.topTag
    local tagHudColor = topTag and tagDisplayConfig[topTag] and tagDisplayConfig[topTag].hudColor or nil

    -- Setup AudioIcon
    SetMpGamerTagAlpha(targetTag, fivemGamerTagCompsEnum.AudioIcon, 255)
    if NetworkIsPlayerTalking(pid) then
        SetMpGamerTagVisibility(targetTag, fivemGamerTagCompsEnum.AudioIcon, true)
        SetMpGamerTagColour(targetTag, fivemGamerTagCompsEnum.AudioIcon, 12) --HUD_COLOUR_YELLOW
        SetMpGamerTagColour(targetTag, fivemGamerTagCompsEnum.GamerName, 12) --HUD_COLOUR_YELLOW
    else
        SetMpGamerTagVisibility(targetTag, fivemGamerTagCompsEnum.AudioIcon, false)
        SetMpGamerTagColour(targetTag, fivemGamerTagCompsEnum.AudioIcon, 0)
        SetMpGamerTagColour(targetTag, fivemGamerTagCompsEnum.GamerName, tagHudColor or 0)
    end
end

--- Clears a single gamer tag (fivem)
local function clearGamerTagFivem(targetTag)
    -- Cleanup name
    ---@diagnostic disable-next-line: param-type-mismatch
    SetMpGamerTagVisibility(targetTag, fivemGamerTagCompsEnum.GamerName, 0)
    -- Cleanup Health
    ---@diagnostic disable-next-line: param-type-mismatch
    SetMpGamerTagVisibility(targetTag, fivemGamerTagCompsEnum.HealthArmour, 0)
    -- Cleanup AudioIcon
    ---@diagnostic disable-next-line: param-type-mismatch
    SetMpGamerTagVisibility(targetTag, fivemGamerTagCompsEnum.AudioIcon, 0)
end

--- Draws a single gamer tag (redm)
local function setGamerTagRedm(targetTag, pid)
    Citizen.InvokeNative(0x93171DDDAB274EB8, targetTag, redmGamerTagCompsEnum.complex) --SetMpGamerTagVisibility
    if MumbleIsPlayerTalking(pid) then
        Citizen.InvokeNative(0x95384C6CE1526EFF, targetTag, redmSpeakerIconHash) --SetMpGamerTagSecondaryIcon
        Citizen.InvokeNative(0x84BD27DDF9575816, targetTag, redmColorYellowHash) --SetMpGamerTagColour
    else
        Citizen.InvokeNative(0x95384C6CE1526EFF, targetTag, nil) --SetMpGamerTagSecondaryIcon
        Citizen.InvokeNative(0x84BD27DDF9575816, targetTag, 0) --SetMpGamerTagColour
    end
end

--- Clears a single gamer tag (redm)
local function clearGamerTagRedm(targetTag)
    Citizen.InvokeNative(0x93171DDDAB274EB8, targetTag, redmGamerTagCompsEnum.none) --SetMpGamerTagVisibility
end

--- Setting game-specific functions
local setGamerTagFunc = IS_FIVEM and setGamerTagFivem or setGamerTagRedm
local clearGamerTagFunc = IS_FIVEM and clearGamerTagFivem or clearGamerTagRedm

--- Loops through every player, checks distance and draws or hides the tag
local function showGamerTags()
    local curCoords = GetEntityCoords(PlayerPedId())
    local allActivePlayers = GetActivePlayers()
    local localPid = PlayerId()

    for _, pid in ipairs(allActivePlayers) do
        local targetPed = GetPlayerPed(pid)
        if not targetPed or targetPed == 0 or not DoesEntityExist(targetPed) then
            if playerGamerTags[pid] and IsMpGamerTagActive(playerGamerTags[pid].gamerTag) then
                if IS_FIVEM then
                    RemoveMpGamerTag(playerGamerTags[pid].gamerTag)
                else
                    Citizen.InvokeNative(0x839BFD7D7E49FE09, Citizen.PointerValueIntInitialized(playerGamerTags[pid].gamerTag))
                end
            end
            playerGamerTags[pid] = nil
        else
            local targetPedCoords = GetEntityCoords(targetPed)
            local distanceM = math.floor(#(targetPedCoords - curCoords))
            local cached = playerGamerTags[pid]

            if distanceM > distanceToCheck then
                -- Out of range: hide the tag once and skip building its label
                if cached and not cached.hidden then
                    if IsMpGamerTagActive(cached.gamerTag) then
                        clearGamerTagFunc(cached.gamerTag)
                    end
                    cached.hidden = true
                end
            else
                local serverId = GetPlayerServerId(pid)
                local topTag = getPlayerTopTag(serverId)
                local tagPrefix = topTag and resolveTagPrefixForId(topTag) or ''
                local distStr = formatDistanceStr(distanceM, pid == localPid)
                local playerName = string.sub(GetPlayerName(pid) or 'unknown', 1, 75)
                local label = buildPlayerLabel(tagPrefix, serverId, playerName, distStr)

                if
                    not cached
                    or cached.ped ~= targetPed
                    or not IsMpGamerTagActive(cached.gamerTag)
                    or cached.topTag ~= topTag
                    or cached.playerName ~= playerName
                then
                    if cached and IsMpGamerTagActive(cached.gamerTag) then
                        if IS_FIVEM then
                            RemoveMpGamerTag(cached.gamerTag)
                        else
                            Citizen.InvokeNative(0x839BFD7D7E49FE09, Citizen.PointerValueIntInitialized(cached.gamerTag))
                        end
                    end
                    cached = {
                        ---@diagnostic disable-next-line: param-type-mismatch
                        gamerTag = CreateFakeMpGamerTag(targetPed, label, false, false, nil, 0),
                        ped = targetPed,
                        topTag = topTag,
                        playerName = playerName,
                        label = label,
                    }
                    playerGamerTags[pid] = cached
                else
                    cached.label = label
                end

                cached.hidden = false
                if IS_FIVEM then
                    setGamerTagFunc(cached.gamerTag, pid, cached)
                else
                    setGamerTagFunc(cached.gamerTag, pid)
                end
            end
        end
    end
end

--- Starts the gamer tag thread
--- Increasing/decreasing the delay realistically only reflects on the
--- delay for the VOIP indicator icon, 250 is fine
local function createGamerTagThread()
    DebugPrint('Starting gamer tag thread')
    CreateThread(function()
        local lastDetailedRefresh = 0
        while isPlayerIdsEnabled do
            showGamerTags()
            local now = GetGameTimer()
            if now - lastDetailedRefresh >= 10000 then
                lastDetailedRefresh = now
                TriggerServerEvent('txsv:req:plist:getDetailed', true)
            end
            Wait(250)
        end

        -- Remove all gamer tags and clear out active table
        cleanAllGamerTags()
    end)
end

--- Function to enable or disable the player ids
---@diagnostic disable-next-line: lowercase-global
function toggleShowPlayerIDs(enabled, showNotification)
    if not TX_MENU_ACCESSIBLE then
        return
    end

    isPlayerIdsEnabled = enabled
    SetStaffStatus('playerIds', isPlayerIdsEnabled)
    local snackMessage
    if isPlayerIdsEnabled then
        snackMessage = 'nui_menu.page_main.player_ids.alert_show'
        refreshOverheadConvars()
        if type(UpdateServerCtx) == 'function' then
            UpdateServerCtx()
        end
        rebuildTagConfig()
        TriggerServerEvent('txsv:req:plist:getDetailed', true)
        createGamerTagThread()
    else
        snackMessage = 'nui_menu.page_main.player_ids.alert_hide'
    end

    if showNotification then
        SendSnackbarMessage('info', snackMessage, true)
    end
    DebugPrint('Show Player IDs Status: ' .. tostring(isPlayerIdsEnabled))
end

--- Receives the return from the server and toggles player ids on/off
RegisterNetEvent('txcl:showPlayerIDs', function(enabled)
    DebugPrint('Received showPlayerIDs event')
    toggleShowPlayerIDs(enabled, true)
end)

-- Remove all gamer tags when the resource stops, since the display
-- thread won't get a chance to run its own cleanup
AddEventHandler('onResourceStop', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then
        return
    end
    if isPlayerIdsEnabled then
        isPlayerIdsEnabled = false
        cleanAllGamerTags()
    end
end)

RegisterNetEvent('txcl:setServerCtx', function()
    rebuildTagConfig()
    refreshOverheadConvars()
    if not isPlayerIdsEnabled then
        return
    end
    TriggerServerEvent('txsv:req:plist:getDetailed', true)
end)

--- Sends perms request to the server to enable player ids
local function togglePlayerIDsHandler()
    TriggerServerEvent('txsv:req:showPlayerIDs', not isPlayerIdsEnabled)
end

RegisterSecureNuiCallback('togglePlayerIDs', function(_, cb)
    togglePlayerIDsHandler()
    cb({})
end)

RegisterCommand('txAdmin:menu:togglePlayerIDs', function()
    if not TX_MENU_ACCESSIBLE then
        return
    end
    if not DoesPlayerHavePerm(TX_MENU_PERMISSIONS, 'menu.viewids') then
        return SendSnackbarMessage('error', 'nui_menu.misc.no_perms', true)
    end
    togglePlayerIDsHandler()
end, false)
