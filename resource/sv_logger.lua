-- Prevent running in monitor mode
if not TX_SERVER_MODE then
    return
end

-- =============================================
--  Logger
-- =============================================

-- Micro optimization & variables
local sub = string.sub
local ostime = os.time
local tonumber = tonumber
local loggerBuffer = {}

--- function logger
--- Sends logs through fd3 to the server & displays the logs on the panel.
---@param src number|string the source of the player who did the action, or 'tx' if internal
---@param type string the action type
---@param data table|nil the event data
local function logger(src, type, data)
    loggerBuffer[#loggerBuffer + 1] = {
        src = src,
        type = type,
        data = data or false,
    }
end

-- send all of the buffered logs every second
CreateThread(function()
    while true do
        Wait(1000)
        if #loggerBuffer > 0 then
            -- Adding timestamp with fake ms to log entries
            local ts = ostime() * 1000
            for i = 1, #loggerBuffer do
                if i <= 999 then
                    loggerBuffer[i].ts = ts + i - 1
                else
                    loggerBuffer[i].ts = ts + 999
                end
            end

            --Sending logs via FD3 and resetting buffer
            local payload = json.encode({
                type = 'txAdminLogData',
                logs = loggerBuffer,
            })
            PrintStructuredTrace(payload)
            loggerBuffer = {}
        end
    end
end)

--Send initial data
CreateThread(function()
    local resList = {}
    local resCount = GetNumResources() - 1
    for i = 0, resCount do
        local resName = GetResourceByFindIndex(i)
        if GetResourceState(resName) == 'started' then
            local resVersion = GetResourceMetadata(resName, 'version', 0)
            if type(resVersion) == 'string' and #resVersion > 0 then
                resList[#resList + 1] = resName .. '/' .. resVersion
            else
                resList[#resList + 1] = resName
            end
        end
    end

    logger('tx', 'LoggerStarted', {
        --txAdmin.metrics.playerDrops data
        gameName = GetConvar('gamename', 'gta5'),
        gameBuild = GetConvar('sv_enforceGameBuild', 'invalid'),
        fxsVersion = GetConvar('version', 'invalid'),
        resources = resList,
    })
end)

-- Explosion handler
local function isInvalid(property, invalidType)
    return (property == nil or property == invalidType)
end

local explosionTypes = {
    'GRENADE',
    'GRENADELAUNCHER',
    'STICKYBOMB',
    'MOLOTOV',
    'ROCKET',
    'TANKSHELL',
    'HI_OCTANE',
    'CAR',
    'PLANE',
    'PETROL_PUMP',
    'BIKE',
    'DIR_STEAM',
    'DIR_FLAME',
    'DIR_WATER_HYDRANT',
    'DIR_GAS_CANISTER',
    'BOAT',
    'SHIP_DESTROY',
    'TRUCK',
    'BULLET',
    'SMOKEGRENADELAUNCHER',
    'SMOKEGRENADE',
    'BZGAS',
    'FLARE',
    'GAS_CANISTER',
    'EXTINGUISHER',
    'PROGRAMMABLEAR',
    'TRAIN',
    'BARREL',
    'PROPANE',
    'BLIMP',
    'DIR_FLAME_EXPLODE',
    'TANKER',
    'PLANE_ROCKET',
    'VEHICLE_BULLET',
    'GAS_TANK',
    'BIRD_CRAP',
    'RAILGUN',
    'BLIMP2',
    'FIREWORK',
    'SNOWBALL',
    'PROXMINE',
    'VALKYRIE_CANNON',
    'AIR_DEFENCE',
    'PIPEBOMB',
    'VEHICLEMINE',
    'EXPLOSIVEAMMO',
    'APCSHELL',
    'BOMB_CLUSTER',
    'BOMB_GAS',
    'BOMB_INCENDIARY',
    'BOMB_STANDARD',
    'TORPEDO',
    'TORPEDO_UNDERWATER',
    'BOMBUSHKA_CANNON',
    'BOMB_CLUSTER_SECONDARY',
    'HUNTER_BARRAGE',
    'HUNTER_CANNON',
    'ROGUE_CANNON',
    'MINE_UNDERWATER',
    'ORBITAL_CANNON',
    'BOMB_STANDARD_WIDE',
    'EXPLOSIVEAMMO_SHOTGUN',
    'OPPRESSOR2_CANNON',
    'MORTAR_KINETIC',
    'VEHICLEMINE_KINETIC',
    'VEHICLEMINE_EMP',
    'VEHICLEMINE_SPIKE',
    'VEHICLEMINE_SLICK',
    'VEHICLEMINE_TAR',
    'SCRIPT_DRONE',
    'RAYGUN',
    'BURIEDMINE',
    'SCRIPT_MISSIL',
}

AddEventHandler('explosionEvent', function(source, ev)
    if
        isInvalid(ev.damageScale, 0)
        or isInvalid(ev.cameraShake, 0)
        or isInvalid(ev.isInvisible, true)
        or isInvalid(ev.isAudible, false)
    then
        return
    end

    if ev.explosionType < -1 or ev.explosionType > #explosionTypes - 1 then
        ev.explosionType = 'UNKNOWN'
    else
        ---@diagnostic disable-next-line: param-type-mismatch
        ev.explosionType = explosionTypes[ev.explosionType + 1] or 'UNKNOWN'
    end

    ---@diagnostic disable-next-line: param-type-mismatch
    local src = tonumber(source) or source
    logger(src, 'explosionEvent', ev)
end)

-- An internal server handler, this is NOT exposed to the client
local function getLogPlayerName(src)
    if type(src) == 'number' then
        local name = sub(GetPlayerName(src) or 'unknown', 1, 75)
        return '[#' .. src .. '] ' .. name
    else
        return '[??] ' .. (src or 'unknown')
    end
end

local function getLogPlayerLocation(src)
    if type(src) ~= 'number' then
        return false
    end

    local ped = GetPlayerPed(src)
    if not ped or ped == 0 then
        return false
    end

    local coords = GetEntityCoords(ped)
    if not coords then
        return false
    end

    return {
        x = coords.x + 0.0,
        y = coords.y + 0.0,
        z = coords.z + 0.0,
    }
end

local function getMenuCommandMeta(action, data)
    if action == 'playerModeChanged' then
        if data == 'godmode' then
            return 'players.godmode', 'players.godmode'
        elseif data == 'noclip' then
            return 'players.noclip', 'players.noclip'
        elseif data == 'superjump' then
            return 'players.superjump', 'players.superjump'
        elseif data == 'none' then
            return 'players.standard_mode', 'players.noclip'
        end
    elseif action == 'teleportWaypoint' then
        return 'players.teleport.waypoint', 'players.teleport'
    elseif action == 'teleportCoords' then
        return 'players.teleport.coords', 'players.teleport'
    elseif action == 'spawnVehicle' then
        return 'menu.vehicle.spawn', 'menu.vehicle.spawn'
    elseif action == 'deleteVehicle' then
        return 'menu.vehicle.delete', 'menu.vehicle.delete'
    elseif action == 'vehicleRepair' then
        return 'menu.vehicle.fix', 'menu.vehicle.fix'
    elseif action == 'vehicleBoost' then
        return 'menu.vehicle.boost', 'menu.vehicle.boost'
    elseif action == 'healSelf' then
        return 'players.heal.self', 'players.heal'
    elseif action == 'healAll' then
        return 'players.heal.all', 'players.heal'
    elseif action == 'healRadius' then
        return 'players.heal.radius', 'players.heal'
    elseif action == 'announcement' then
        return 'announcement', 'announcement'
    elseif action == 'clearArea' then
        return 'menu.clear_area', 'menu.clear_area'
    elseif action == 'spectatePlayer' then
        return 'players.spectate', 'players.spectate'
    elseif action == 'freezePlayer' then
        return 'players.freeze', 'players.freeze'
    elseif action == 'teleportPlayer' then
        return 'players.teleport.player', 'players.teleport'
    elseif action == 'healPlayer' then
        return 'players.heal.player', 'players.heal'
    elseif action == 'summonPlayer' then
        return 'players.summon', 'players.teleport'
    elseif action == 'drunkEffect' then
        return 'players.troll.drunk', 'players.troll'
    elseif action == 'setOnFire' then
        return 'players.troll.fire', 'players.troll'
    elseif action == 'wildAttack' then
        return 'players.troll.wild_attack', 'players.troll'
    elseif action == 'showPlayerIDs' then
        return 'menu.viewids', 'menu.viewids'
    elseif action == 'showMapBlips' then
        return 'menu.mapblips', 'menu.mapblips'
    elseif action == 'restartServer' then
        return 'control.server.restart', 'control.server'
    elseif action == 'stopServer' then
        return 'control.server.stop', 'control.server'
    end

    return action, false
end

AddEventHandler('txsv:logger:menuEvent', function(source, action, allowed, data)
    if not allowed then
        return
    end
    local message

    --SELF menu options
    if action == 'playerModeChanged' then
        if data == 'godmode' then
            message = 'enabled god mode'
        elseif data == 'noclip' then
            message = 'enabled noclip'
        elseif data == 'superjump' then
            message = 'enabled super jump'
        elseif data == 'none' then
            message = 'became mortal (standard mode)'
        else
            message = 'changed playermode to unknown'
        end
    elseif action == 'teleportWaypoint' then
        message = 'teleported to a waypoint'
    elseif action == 'teleportCoords' then
        if type(data) ~= 'table' then
            return
        end
        local x = data.x
        local y = data.y
        local z = data.z
        message = ('teleported to coordinates (x=%.3f, y=%0.3f, z=%0.3f)'):format(x or 0.0, y or 0.0, z or 0.0)
    elseif action == 'spawnVehicle' then
        if type(data) ~= 'string' then
            return
        end
        message = 'spawned a vehicle (model: ' .. data .. ')'
    elseif action == 'deleteVehicle' then
        message = 'deleted a vehicle'
    elseif action == 'vehicleRepair' then
        message = 'repaired their vehicle'
    elseif action == 'vehicleBoost' then
        message = 'boosted their vehicle'
    elseif action == 'healSelf' then
        message = 'healed themself'
    elseif action == 'healAll' then
        message = 'healed all players!'
    elseif action == 'healRadius' then
        if type(data) ~= 'number' then
            return
        end
        message = 'healed players within a ' .. data .. 'm radius'
    elseif action == 'announcement' then
        if type(data) ~= 'string' then
            return
        end
        message = 'made a server-wide announcement: ' .. data
    elseif action == 'clearArea' then
        if type(data) ~= 'number' then
            return
        end
        message = 'cleared an area with ' .. data .. 'm radius'

    --INTERACTION modal options
    elseif action == 'spectatePlayer' then
        message = 'started spectating player ' .. getLogPlayerName(data)
    elseif action == 'freezePlayer' then
        message = 'toggled freeze on player ' .. getLogPlayerName(data)
    elseif action == 'teleportPlayer' then
        if type(data) ~= 'table' then
            return
        end
        local playerName = getLogPlayerName(data.target)
        local x = data.x or 0.0
        local y = data.y or 0.0
        local z = data.z or 0.0
        message = ('teleported to player %s (x=%.3f, y=%.3f, z=%.3f)'):format(playerName, x, y, z)
    elseif action == 'healPlayer' then
        message = 'healed player ' .. getLogPlayerName(data)
    elseif action == 'summonPlayer' then
        message = 'summoned player ' .. getLogPlayerName(data)

    --TROLL modal options
    elseif action == 'drunkEffect' then
        message = 'triggered drunk effect on ' .. getLogPlayerName(data)
    elseif action == 'setOnFire' then
        message = 'set ' .. getLogPlayerName(data) .. ' on fire'
    elseif action == 'wildAttack' then
        message = 'triggered wild attack on ' .. getLogPlayerName(data)
    elseif action == 'showPlayerIDs' then
        if type(data) ~= 'boolean' then
            return
        end
        if data then
            message = 'turned show player IDs on'
        else
            message = 'turned show player IDs off'
        end
    elseif action == 'showMapBlips' then
        if type(data) ~= 'boolean' then
            return
        end
        if data then
            message = 'turned map blips on'
        else
            message = 'turned map blips off'
        end
    elseif action == 'restartServer' then
        message = 'requested a server restart'
    elseif action == 'stopServer' then
        message = 'requested a server stop'

    --In case of unknown event
    else
        logger(source, 'DebugMessage', 'unknown menu event ' .. action)
        return
    end

    local commandId, permissionId = getMenuCommandMeta(action, data)

    logger(source, 'MenuEvent', {
        action = action,
        commandId = commandId,
        permissionId = permissionId,
        location = getLogPlayerLocation(source),
        message = message,
    })
end)

-- Extra handlers
RegisterNetEvent('txsv:logger:deathEvent', function(killer, cause)
    local logData = {
        cause = cause,
        killer = killer,
    }
    logger(source, 'DeathNotice', logData)
end)

--FIXME: deprecate or allow server commands
--FIXME: didn't migrate to keep compatibility with external calls
local warnedCommandExecuted = false
RegisterNetEvent('txaLogger:CommandExecuted', function(data)
    if source ~= 0 then return end
    if not warnedCommandExecuted then
        warnedCommandExecuted = true
        TxPrint(("^3DEPRECATED: the event 'txaLogger:CommandExecuted' is deprecated and will be removed in a future release. Caller invoked from resource '%s'. Update your code to call logger(source, 'CommandExecuted', data) directly or use the current txAdmin logging API."):format(GetInvokingResource() or 'unknown'))
    end
    logger(source, 'CommandExecuted', data)
end)

--FIXME: didn't migrate to keep compatibility with external calls
local warnedDebugMessage = false
RegisterNetEvent('txaLogger:DebugMessage', function(data)
    if source ~= 0 then return end
    if not warnedDebugMessage then
        warnedDebugMessage = true
        TxPrint(("^3DEPRECATED: the event 'txaLogger:DebugMessage' is deprecated and will be removed in a future release. Caller invoked from resource '%s'. Update your code to call logger(source, 'DebugMessage', data) directly or use the current txAdmin logging API."):format(GetInvokingResource() or 'unknown'))
    end
    logger(source, 'DebugMessage', data)
end)

local function logChatMessage(src, author, text)
    local logData = {
        author = author,
        text = text,
    }
    logger(src, 'ChatMessage', logData)
end
RegisterNetEvent('chatMessage', logChatMessage)
AddEventHandler('txsv:logger:addChatMessage', logChatMessage)
