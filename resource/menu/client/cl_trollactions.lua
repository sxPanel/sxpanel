-- Prevent running if menu is disabled
if not TX_MENU_ENABLED then
    return
end

-- =============================================
--  Troll action logic from the player modal is located here (callbacks, events)
-- =============================================

local EFFECT_TIME_MS = GetConvarInt('txAdmin-menuDrunkDuration', 30) * 1000
local DRUNK_ANIM_SET = 'move_m@drunk@verydrunk'

local DRUNK_DRIVING_EFFECTS = {
    1, -- brake
    7, --turn left + accelerate
    8, -- turn right + accelerate
    23, -- accelerate
    4, -- turn left 90 + braking
    5, -- turn right 90 + braking
}

local function getRandomDrunkCarTask()
    return DRUNK_DRIVING_EFFECTS[math.random(#DRUNK_DRIVING_EFFECTS)]
end

-- NOTE: We might want to check if a player already has an effect
local function drunkThreadFivem()
    local playerPed = PlayerPedId()
    local isDrunk = true

    DebugPrint('Starting drunk effect')
    RequestAnimSet(DRUNK_ANIM_SET)
    while not HasAnimSetLoaded(DRUNK_ANIM_SET) do
        Wait(5)
    end

    SetPedMovementClipset(playerPed, DRUNK_ANIM_SET, 0.0)
    ShakeGameplayCam('DRUNK_SHAKE', 3.0)
    SetPedIsDrunk(playerPed, true)
    SetTransitionTimecycleModifier('spectator5', 10.00)

    CreateThread(function()
        while isDrunk do
            local vehPedIsIn = GetVehiclePedIsIn(playerPed, false)
            local isPedInVehicleAndDriving = (vehPedIsIn ~= 0) and (GetPedInVehicleSeat(vehPedIsIn, -1) == playerPed)

            if isPedInVehicleAndDriving then
                local randomTask = getRandomDrunkCarTask()
                DebugPrint('Dispatching random car tasks: ' .. randomTask)
                TaskVehicleTempAction(playerPed, vehPedIsIn, randomTask, 500)
            end

            Wait(5000)
        end
    end)

    Wait(EFFECT_TIME_MS)
    DebugPrint('Cleaning up drunk effect')
    isDrunk = false
    SetTransitionTimecycleModifier('default', 10.00)
    StopGameplayCamShaking(true)
    ResetPedMovementClipset(playerPed, 0.0)
    RemoveAnimSet(DRUNK_ANIM_SET)
end

local REDM_DRUNK_FX = 'PlayerDrunkAberdeen'
local function drunkThreadRedm()
    DebugPrint('Starting drunk effect')
    AnimpostfxPlay(REDM_DRUNK_FX)
    Citizen.InvokeNative(0x406CCF555B04FAD3, PlayerPedId(), 1, 1.0) --SetPedDrunkness
    Wait(EFFECT_TIME_MS)
    DebugPrint('Cleaning up drunk effect')
    AnimpostfxStop(REDM_DRUNK_FX)
    Citizen.InvokeNative(0x406CCF555B04FAD3, PlayerPedId(), 1, 0.0) --SetPedDrunkness
end

--[[ Wild Attack command ]]
local attackAnimals
if IS_FIVEM then
    attackAnimals = {
        GetHashKey('a_c_mtlion'),
        GetHashKey('a_c_rottweiler'),
        GetHashKey('a_c_shepherd'),
        GetHashKey('a_c_coyote'),
    }
else
    attackAnimals = {
        GetHashKey('a_c_wolf'),
        GetHashKey('a_c_bear_01'),
        GetHashKey('a_c_cougar_01'),
        GetHashKey('a_c_bearblack_01'),
    }
end
local PACK_SIZE = 3
local MAX_LIVE_ANIMALS = 6
local SPAWN_DIST_MIN = 15.0
local SPAWN_DIST_MAX = 25.0
local ATTACK_DURATION_MS = 60000
local MODEL_LOAD_TIMEOUT_MS = 5000

-- Dedicated group so only our animals hate the player, not every animal in the world
local _, wildGroupHash = AddRelationshipGroup('SX_WILD_ATTACK')
SetRelationshipBetweenGroups(5, wildGroupHash, GetHashKey('PLAYER'))
local spawnedAnimals = {}

local function deleteAnimal(animalPed)
    if DoesEntityExist(animalPed) then
        SetEntityAsMissionEntity(animalPed, true, true)
        DeleteEntity(animalPed)
    end
    for i = #spawnedAnimals, 1, -1 do
        if spawnedAnimals[i] == animalPed then
            table.remove(spawnedAnimals, i)
        end
    end
end

local function loadModel(modelHash)
    RequestModel(modelHash)
    local deadline = GetGameTimer() + MODEL_LOAD_TIMEOUT_MS
    while not HasModelLoaded(modelHash) do
        if GetGameTimer() > deadline then
            return false
        end
        Wait(15)
    end
    return true
end

local function spawnAttackAnimal(playerPed, animalHash)
    local angle = math.random() * 2 * math.pi
    local dist = SPAWN_DIST_MIN + math.random() * (SPAWN_DIST_MAX - SPAWN_DIST_MIN)
    local spawnCoords = GetOffsetFromEntityInWorldCoords(playerPed, math.cos(angle) * dist, math.sin(angle) * dist, 0.0)
    local groundFound, groundZ =
        GetGroundZAndNormalFor_3dCoord(spawnCoords.x, spawnCoords.y, spawnCoords.z + 10.0)
    if not groundFound then
        -- Fallback: ground query failed (e.g., spawn point over water/void), use the spawn coord Z
        groundZ = spawnCoords.z
    end
    local heading = GetHeadingFromVector_2d(-math.cos(angle), -math.sin(angle))

    local animalPed
    if IS_FIVEM then
        animalPed =
            ---@diagnostic disable-next-line: param-type-mismatch
            CreatePed(1, animalHash, spawnCoords.x, spawnCoords.y, groundZ, heading, true, false)
    else
        animalPed =
            ---@diagnostic disable-next-line: missing-parameter, param-type-mismatch
            CreatePed(animalHash, spawnCoords.x, spawnCoords.y, groundZ, heading, true, false)
    end

    -- CreatePed can fail (invalid coords, entity limits, etc)
    if not animalPed or animalPed <= 0 or not DoesEntityExist(animalPed) then
        DebugPrint('^1Failed to create wild attack animal ped')
        return nil
    end
    spawnedAnimals[#spawnedAnimals + 1] = animalPed

    if IS_REDM then
        Citizen.InvokeNative(0x77FF8D35EEC6BBC4, animalPed, 1, 0) --EquipMetaPedOutfitPreset
    end

    -- setting player as enemy
    ---@diagnostic disable-next-line: param-type-mismatch
    SetPedFleeAttributes(animalPed, 0, false)
    SetPedCombatAttributes(animalPed, 46, true) --BF_AlwaysFight
    SetPedCombatAttributes(animalPed, 5, true) --BF_CanFightArmedPedsWhenNotArmed
    SetPedRelationshipGroupHash(animalPed, wildGroupHash)
    SetBlockingOfNonTemporaryEvents(animalPed, true)
    SetPedKeepTask(animalPed, true)
    ---@diagnostic disable-next-line: param-type-mismatch
    TaskCombatPed(animalPed, playerPed, 0, 16)
    return animalPed
end

local function startWildAttack()
    local playerPed = PlayerPedId()
    local packSize = math.min(PACK_SIZE, MAX_LIVE_ANIMALS - #spawnedAnimals)
    if packSize <= 0 then
        DebugPrint('Wild attack skipped, too many animals already alive')
        return
    end

    local pack = {}
    for _ = 1, packSize do
        local animalHash = attackAnimals[math.random(#attackAnimals)]
        if loadModel(animalHash) then
            pack[#pack + 1] = spawnAttackAnimal(playerPed, animalHash)
            SetModelAsNoLongerNeeded(animalHash)
        else
            DebugPrint('^1Failed to load wild attack animal model')
        end
    end
    if #pack == 0 then
        return
    end

    -- Cleanup once the time runs out, the target dies, or the whole pack is dead
    CreateThread(function()
        local endTime = GetGameTimer() + ATTACK_DURATION_MS
        while GetGameTimer() < endTime do
            Wait(1000)
            if IsEntityDead(PlayerPedId()) then
                break
            end
            local anyAlive = false
            for _, animalPed in ipairs(pack) do
                if DoesEntityExist(animalPed) and not IsEntityDead(animalPed) then
                    anyAlive = true
                    break
                end
            end
            if not anyAlive then
                break
            end
        end
        for _, animalPed in ipairs(pack) do
            deleteAnimal(animalPed)
        end
    end)
end
-- RegisterCommand('atk', startWildAttack)

-- Delete any spawned animals so they don't become orphaned network objects
AddEventHandler('onResourceStop', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then
        return
    end
    for _, animalPed in ipairs(spawnedAnimals) do
        if DoesEntityExist(animalPed) then
            DeleteEntity(animalPed)
        end
    end
    spawnedAnimals = {}
end)

--[[ Net Events ]]
RegisterNetEvent('txcl:setDrunk', function()
    if IS_FIVEM then
        drunkThreadFivem()
    else
        drunkThreadRedm()
    end
end)

RegisterNetEvent('txcl:setOnFire', function()
    DebugPrint('Setting player on fire')
    local playerPed = PlayerPedId()
    StartEntityFire(playerPed)
end)

RegisterNetEvent('txcl:wildAttack', function()
    startWildAttack()
end)

--[[ NUI Callbacks ]]
RegisterSecureNuiCallback('drunkEffectPlayer', function(data, cb)
    TriggerServerEvent('txsv:req:troll:setDrunk', tonumber(data.id))
    cb({})
end)

RegisterSecureNuiCallback('setOnFire', function(data, cb)
    TriggerServerEvent('txsv:req:troll:setOnFire', tonumber(data.id))
    cb({})
end)

RegisterSecureNuiCallback('wildAttack', function(data, cb)
    TriggerServerEvent('txsv:req:troll:wildAttack', tonumber(data.id))
    cb({})
end)
