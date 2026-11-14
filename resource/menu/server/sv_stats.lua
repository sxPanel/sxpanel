-- Prevent running in monitor mode
if not TX_SERVER_MODE then
    return
end
-- Prevent running if menu is disabled
if not TX_MENU_ENABLED then
    return
end

-- =============================================
--  Basic live stats for the NUI Stats tab
-- =============================================

local TX_STATS_BOOT_TS = os.time()

RegisterNetEvent('txsv:req:getStats', function()
    local src = source
    if TX_ADMINS[tostring(src)] == nil then
        DebugPrint('Ignoring unauthenticated getStats() by ' .. src)
        return
    end

    local numResources = GetNumResources()
    local startedResources = 0
    for i = 0, numResources - 1 do
        local resName = GetResourceByFindIndex(i)
        if resName and GetResourceState(resName) == 'started' then
            startedResources = startedResources + 1
        end
    end

    TriggerClientEvent('txcl:setStats', src, {
        playerCount = #GetPlayers(),
        resourceCount = startedResources,
        uptimeSeconds = os.time() - TX_STATS_BOOT_TS,
    })
end)
