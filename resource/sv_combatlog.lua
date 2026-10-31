-- Prevent running in monitor mode
if not TX_SERVER_MODE then
    return
end

-- =============================================
--  Combat Log
--  Groups player-vs-player weapon damage into attacker->victim "engagements".
--  - Lethal engagements are attached to the victim's DeathNotice (see sv_logger.lua).
--  - Non-lethal engagements are logged as a single CombatDamage summary once
--    the pair has been quiet for the configured window.
--  Requires OneSync (weaponDamageEvent is only routed through the server with it).
--  Everything here is log-only: no gameplay decisions are made from client-reported data.
-- =============================================

-- Micro optimization
local floor = math.floor
local min = math.min
local max = math.max
local tonumber = tonumber
local GetGameTimer = GetGameTimer
local GetPlayerPed = GetPlayerPed
local GetEntityCoords = GetEntityCoords
local DoesEntityExist = DoesEntityExist

-- Limits (guard against a client flooding damage events)
local MAX_OPEN_PER_ATTACKER = 32
local MAX_OPEN_TOTAL = 1024
local MAX_DAMAGE_PER_HIT = 10000
local MAX_WEAPONS_TRACKED = 8
local HEAD_COMPONENT = 20 -- ped component index for the head (FiveM)

-- Config (mirrors txAdmin-combatLog* convars, refreshed by the flush thread)
local isEnabled = false
local logDamageSummaries = true
local engagementWindowMs = 10000

local function refreshConfig()
    isEnabled = GetConvarBool('txAdmin-combatLogEnabled')
    logDamageSummaries = GetConvarBool('txAdmin-combatLogDamageSummaries', true)
    local windowSeconds = tonumber(GetConvar('txAdmin-combatLogEngagementWindow', '10')) or 10
    engagementWindowMs = floor(min(60, max(3, windowSeconds)) * 1000)
end
refreshConfig()

-- State: engagements keyed by "attacker:victim", plus open counts per attacker
local engagements = {}
local openPerAttacker = {}
local openTotal = 0

local function pairKey(attacker, victim)
    return attacker .. ':' .. victim
end

local function round1(value)
    return floor(value * 10 + 0.5) / 10
end

local function getPedDistance(pedA, pedB)
    if not pedA or pedA == 0 or not pedB or pedB == 0 then
        return nil
    end
    if not DoesEntityExist(pedA) or not DoesEntityExist(pedB) then
        return nil
    end
    return #(GetEntityCoords(pedA) - GetEntityCoords(pedB))
end

local function removeEngagement(key, engagement)
    engagements[key] = nil
    openTotal = openTotal - 1
    local count = (openPerAttacker[engagement.attacker] or 1) - 1
    openPerAttacker[engagement.attacker] = count > 0 and count or nil
end

--- Serializes an engagement into the compact table sent through FD3
local function summarize(engagement)
    local weapons = {}
    local primaryWeapon, primaryHits = nil, 0
    for name, hits in pairs(engagement.weapons) do
        weapons[#weapons + 1] = name
        if hits > primaryHits then
            primaryWeapon, primaryHits = name, hits
        end
    end

    return {
        victim = engagement.victim,
        hits = engagement.hits,
        damage = floor(engagement.damage + 0.5),
        headshots = engagement.headshots,
        weapon = primaryWeapon or 'unknown',
        weapons = weapons,
        distance = engagement.lastDistance and round1(engagement.lastDistance) or false,
        maxDistance = engagement.maxDistance and round1(engagement.maxDistance) or false,
        durationMs = max(0, engagement.lastHitAt - engagement.firstHitAt),
    }
end

--- Resolves the player server ID that owns a hit ped, or nil if it isn't a player
local function resolveVictimFromNetId(netId)
    if type(netId) ~= 'number' or netId <= 0 then
        return nil, nil
    end
    local ped = NetworkGetEntityFromNetworkId(netId)
    if not ped or ped == 0 or not DoesEntityExist(ped) then
        return nil, nil
    end
    if GetEntityType(ped) ~= 1 or not IsPedAPlayer(ped) then
        return nil, nil
    end
    local owner = NetworkGetEntityOwner(ped)
    if not owner or owner <= 0 or GetPlayerPed(owner) ~= ped then
        return nil, nil
    end
    return owner, ped
end

AddEventHandler('weaponDamageEvent', function(sender, data)
    if not isEnabled or type(data) ~= 'table' then
        return
    end

    local attacker = tonumber(sender)
    if not attacker or attacker <= 0 then
        return
    end

    local hitNetId = data.hitGlobalId
    if (not hitNetId or hitNetId == 0) and type(data.hitGlobalIds) == 'table' then
        hitNetId = data.hitGlobalIds[1]
    end
    local victim, victimPed = resolveVictimFromNetId(hitNetId)
    if not victim or victim == attacker then
        return
    end

    local key = pairKey(attacker, victim)
    local engagement = engagements[key]
    local now = GetGameTimer()
    if not engagement then
        if openTotal >= MAX_OPEN_TOTAL or (openPerAttacker[attacker] or 0) >= MAX_OPEN_PER_ATTACKER then
            return
        end
        engagement = {
            attacker = attacker,
            victim = victim,
            hits = 0,
            damage = 0.0,
            headshots = 0,
            weapons = {},
            weaponCount = 0,
            firstHitAt = now,
            lastHitAt = now,
            lastDistance = nil,
            maxDistance = nil,
        }
        engagements[key] = engagement
        openTotal = openTotal + 1
        openPerAttacker[attacker] = (openPerAttacker[attacker] or 0) + 1
    end

    local damage = tonumber(data.weaponDamage) or 0
    damage = min(MAX_DAMAGE_PER_HIT, max(0, damage))

    local weaponName = GetTxWeaponName(tonumber(data.weaponType)) or 'unknown'
    if engagement.weapons[weaponName] then
        engagement.weapons[weaponName] = engagement.weapons[weaponName] + 1
    elseif engagement.weaponCount < MAX_WEAPONS_TRACKED then
        engagement.weapons[weaponName] = 1
        engagement.weaponCount = engagement.weaponCount + 1
    end

    engagement.hits = engagement.hits + 1
    engagement.damage = engagement.damage + damage
    if IS_FIVEM and data.hitComponent == HEAD_COMPONENT then
        engagement.headshots = engagement.headshots + 1
    end
    engagement.lastHitAt = now

    -- Distance is computed server-side from synced entity positions, not taken from the client
    local distance = getPedDistance(GetPlayerPed(attacker), victimPed)
    if distance then
        engagement.lastDistance = distance
        if not engagement.maxDistance or distance > engagement.maxDistance then
            engagement.maxDistance = distance
        end
    end
end)

--- Consumes the killer->victim engagement (if any) and returns its summary for the DeathNotice.
--- Called from sv_logger.lua when the victim reports their death.
---@param killer number
---@param victim number
---@return table|nil
function TxCombatLogConsumeKill(killer, victim)
    if not isEnabled then
        return nil
    end

    local key = pairKey(killer, victim)
    local engagement = engagements[key]
    if engagement then
        removeEngagement(key, engagement)
        local summary = summarize(engagement)
        summary.victim = nil
        return summary
    end

    -- No tracked damage (e.g. vehicle kill or OneSync disabled), still record the distance
    local distance = getPedDistance(GetPlayerPed(killer), GetPlayerPed(victim))
    return {
        hits = 0,
        damage = 0,
        headshots = 0,
        distance = distance and round1(distance) or false,
    }
end

--- Flushes engagements that went quiet, logging them as non-lethal damage summaries
local function flushExpired(force)
    local now = GetGameTimer()
    for key, engagement in pairs(engagements) do
        if force or now - engagement.lastHitAt >= engagementWindowMs then
            removeEngagement(key, engagement)
            if logDamageSummaries and isEnabled then
                TxLogServerEvent(engagement.attacker, 'CombatDamage', summarize(engagement))
            end
        end
    end
end

--- Flushes all engagements involving a player (used when they leave)
local function flushPlayer(playerId)
    for key, engagement in pairs(engagements) do
        if engagement.attacker == playerId or engagement.victim == playerId then
            removeEngagement(key, engagement)
            if logDamageSummaries and isEnabled then
                TxLogServerEvent(engagement.attacker, 'CombatDamage', summarize(engagement))
            end
        end
    end
end

AddEventHandler('playerDropped', function()
    local playerId = tonumber(source)
    if not playerId or openTotal == 0 then
        return
    end
    flushPlayer(playerId)
end)

-- Flush thread: idles slowly while nothing is tracked, ticks faster while engagements are open
CreateThread(function()
    local lastConfigRefresh = 0
    while true do
        Wait(openTotal > 0 and 1000 or 5000)

        local now = GetGameTimer()
        if now - lastConfigRefresh >= 5000 then
            lastConfigRefresh = now
            local wasEnabled = isEnabled
            refreshConfig()
            if wasEnabled and not isEnabled then
                -- Disabled at runtime: drop everything without logging
                engagements = {}
                openPerAttacker = {}
                openTotal = 0
            end
        end

        if openTotal > 0 then
            flushExpired(false)
        end
    end
end)
