-- =============================================
--  TX_SERVER_CTX Synchronization
-- =============================================
TX_SERVER_CTX = false

--- Updates TX_SERVER_CTX based on GlobalState and will send it to NUI
--- NOTE: for now the TX_SERVER_CTX is only being set when the menu tries to load (enabled or not)
function UpdateServerCtx()
    TX_STATEBAG_SERVER_CTX = GlobalState.txAdminServerCtx
    if TX_STATEBAG_SERVER_CTX == nil then
        DebugPrint('^3ServerCtx fallback support activated.')
        TriggerServerEvent('txsv:req:TX_SERVER_CTX')
    else
        TX_SERVER_CTX = TX_STATEBAG_SERVER_CTX
        DebugPrint('^2ServerCtx updated from global state.')
        SendMenuMessage('setServerCtx', TX_SERVER_CTX)
    end
end

RegisterNetEvent('txcl:setServerCtx', function(ctx)
    if type(ctx) ~= 'table' then
        return
    end
    TX_SERVER_CTX = ctx
    DebugPrint('^2ServerCtx updated from server event.')
    SendMenuMessage('setServerCtx', TX_SERVER_CTX)
end)

-- =============================================
--  Announcement, DirectMessage and Warn handling
-- =============================================
-- Dispatch Announcements
RegisterNetEvent('txcl:showAnnouncement', function(message, author)
    SendMenuMessage('addAnnounceMessage', {
        message = message,
        author = author,
    })
end)
RegisterNetEvent('txcl:showDirectMessage', function(message, author)
    SendMenuMessage('addDirectMessage', {
        message = message,
        author = author,
    })
end)

local dismissKey, dismissKeyGroup
if IS_FIVEM then
    dismissKey = 22
    dismissKeyGroup = 0
else
    dismissKey = 0xD9D0E1C0
    dismissKeyGroup = 1
end

local warnActive = false

RegisterNetEvent('txcl:showWarning', function(author, reason, actionId, isWarningNew)
    -- Cancel any previous active warning
    if warnActive then
        SendMenuMessage('closeWarning')
    end
    warnActive = true

    toggleMenuVisibility(false)
    SendMenuMessage('setWarnOpen', {
        reason = reason,
        warnedBy = author,
        isWarningNew = isWarningNew,
    })
    local currentActionId = actionId
    CreateThread(function()
        local countLimit = 100 --10 seconds
        local count = 0
        while true do
            Wait(100)
            -- Exit the thread if the warning was dismissed externally
            if not warnActive then
                return
            end
            if IsControlPressed(dismissKeyGroup, dismissKey) then
                count = count + 1
                if count >= countLimit then
                    warnActive = false
                    SendMenuMessage('closeWarning')
                    TriggerServerEvent('txsv:ackWarning', currentActionId)
                    return
                elseif math.fmod(count, 10) == 0 then
                    local secsRemaining = (countLimit - count) / 10
                    SendMenuMessage('pulseWarning', secsRemaining)
                end
            else
                if count > 10 then
                    SendMenuMessage('resetWarning')
                end
                count = 0
            end
        end
    end)
end)

--- Stores pending warn data sent from the server via txcl:setPendingWarn.
--- The warn is displayed locally once the player starts walking,
--- avoiding a server round-trip.
local storedPendingWarn = nil
local isAwaitingWalk = false

--- Awaits the player to start walking before showing a stored pending warning,
--- to prevent players from being warned during character selection.
--- Unlike the warn dismissal, stopping does not reset the counter.
--- Only started when there is a pending warn, so it costs nothing otherwise.
--- NOTE: Doing walk detection this way because IsPedRunning isn't reliable,
--- and IsPedStopped is true even while teleporting.
local function awaitWalkThenShowWarn()
    if isAwaitingWalk then
        return
    end
    isAwaitingWalk = true
    local minimumMoveCycles = 20 -- around 5 seconds of walking
    local moveCycles = 0
    local hasPedStartedWalking = false
    while true do
        Wait(250)
        local ped = PlayerPedId()
        if type(ped) == 'number' and ped > 0 then
            if hasPedStartedWalking then
                if not IsPedStopped(ped) then
                    moveCycles = moveCycles + 1
                    if moveCycles >= minimumMoveCycles then
                        if storedPendingWarn then
                            local warn = storedPendingWarn
                            storedPendingWarn = nil
                            -- Show the warning using the existing showWarning handler
                            TriggerEvent('txcl:showWarning', warn.author, warn.reason, warn.actionId, false)
                        end
                        DebugPrint('Player started walking.')
                        isAwaitingWalk = false
                        return
                    end
                end
            elseif IsPedWalking(ped) or IsPedRunning(ped) then
                hasPedStartedWalking = true
            end
        end
    end
end

RegisterNetEvent('txcl:setPendingWarn', function(warnData)
    if type(warnData) == 'table' and warnData.author and warnData.reason and warnData.actionId then
        storedPendingWarn = warnData
        DebugPrint('Received pending warn for actionId: ' .. tostring(warnData.actionId))
        CreateThread(awaitWalkThenShowWarn)
    end
end)

-- =============================================
--  Other stuff
-- =============================================
-- Removing unwanted chat suggestions
-- We only want suggestion for: /tx, /txAdmin-reauth
-- The suggestion is added after 500ms, so we need to wait more
CreateThread(function()
    Wait(1000)
    local suggestionsToRemove = {
        --Commands
        '/txadmin',
        '/txaPing',
        '/txaEvent',
        '/txaReportResources',
        '/txaSetDebugMode',
        '/txaInitialData',
        '/txaSendEvent',

        --Keybinds
        '/txAdmin:menu:openPlayersPage',
        '/txAdmin:menu:clearArea',
        '/txAdmin:menu:healMyself',
        '/txAdmin:menu:tpBack',
        '/txAdmin:menu:tpToCoords',
        '/txAdmin:menu:tpToWaypoint',
        '/txAdmin:menu:noClipToggle',
        '/txAdmin:menu:togglePlayerIDs',
        '/txAdmin:menu:boostVehicle',
        '/txAdmin:menu:deleteVehicle',
        '/txAdmin:menu:fixVehicle',
        '/txAdmin:menu:spawnVehicle',

        --Convars
        '/txAdmin-version',
        '/txAdmin-locale',
        '/txAdmin-localeFile',
        '/txAdmin-verbose',
        '/txAdmin-luaComHost',
        '/txAdmin-luaComToken',
        '/txAdmin-checkPlayerJoin',
        '/txAdmin-pipeToken',
        '/txAdmin-debugMode',
        '/txAdmin-hideDefaultAnnouncement',
        '/txAdmin-hideDefaultDirectMessage',
        '/txAdmin-hideDefaultWarning',
        '/txAdmin-hideDefaultScheduledRestartWarning',
        '/txAdmin-hideAdminInPunishments',
        '/txAdmin-hideAdminInMessages',
        '/txAdmin-serverName',
        '/txAdminServerMode',

        --Menu convars
        '/txAdmin-menuEnabled',
        '/txAdmin-menuAlignRight',
        '/txAdmin-menuPageKey',
        '/txAdmin-menuPlayerIdDistance',
        '/txAdmin-menuDrunkDuration',
    }

    for _, suggestion in ipairs(suggestionsToRemove) do
        TriggerEvent('chat:removeSuggestion', suggestion)
    end
end)

-- =============================================
--  Helper to protect the NUI callbacks from CSRF attacks
--  NOTE: This is a temporary fix for the NUI callback Origin issue
-- =============================================
--- Check if a NUI callback is from the correct Origin
--- technically no request should come from nui://monitor, since the manifest version is cerulean
---@param headers table
---@return boolean
function IsNuiRequestOriginValid(headers)
    if type(headers) ~= 'table' then
        return false --no clue
    end
    if headers['Origin'] == nil then
        return true --probably legacy page
    end
    if type(headers['Origin']) ~= 'string' or headers['Origin'] == '' then
        return false --no clue
    end

    if headers['Origin'] == 'https://cfx-nui-monitor' then
        return true --probably self
    end
    if headers['Origin'] == 'https://monitor' then
        return true --probably legacy iframe inside web iframe
    end

    -- warn admin of possible csrf attempt
    if TX_MENU_ACCESSIBLE and SendPersistentAlert then
        SendPersistentAlert('csrfWarning', 'error', 'nui_menu.misc.csrf_alert', true, { origin = headers['Origin'] })
    end

    return false
end

--- Wrapper for RegisterRawNuiCallback which mimics the behavior of RegisterNUICallback
--- but checks the origin of the request to prevent CSRF attacks
function RegisterSecureNuiCallback(callbackName, funcCallback)
    RegisterRawNuiCallback(callbackName, function(req, nuiCallback)
        if not IsNuiRequestOriginValid(req.headers) then
            DebugPrint(('^1Invalid NUI callback origin for %s'):format(callbackName))
            return nuiCallback({
                status = 403,
                body = '{}',
            })
        end

        -- calls the function
        funcCallback(json.decode(req.body), function(data)
            nuiCallback({
                status = 200,
                body = type(data) == 'table' and json.encode(data) or '{}',
            })
        end)
    end)
end
