-- Prevent running in monitor mode
if not TX_SERVER_MODE then
    return
end

-- =============================================
--  Report all resource events to txAdmin
-- =============================================

local function reportResourceEvent(event, resource)
    -- print(string.format("\27[107m\27[30m %s: %s \27[0m", event, resource))
    PrintStructuredTrace(json.encode({
        type = 'txAdminResourceEvent',
        event = event,
        resource = resource,
    }))
end

-- An event that is triggered when a resource is trying to start.
-- This can be canceled to prevent the resource from starting.
AddEventHandler('onResourceStarting', function(resource)
    reportResourceEvent('onResourceStarting', resource)
end)

-- An event that is triggered immediately when a resource has started.
AddEventHandler('onResourceStart', function(resource)
    reportResourceEvent('onResourceStart', resource)
end)

-- An event that is queued after a resource has started.
AddEventHandler('onServerResourceStart', function(resource)
    reportResourceEvent('onServerResourceStart', resource)
end)

-- A server-side event triggered when the refresh command completes.
AddEventHandler('onResourceListRefresh', function(resource)
    reportResourceEvent('onResourceListRefresh', resource)
end)

-- An event that is triggered immediately when a resource is stopping.
AddEventHandler('onResourceStop', function(resource)
    reportResourceEvent('onResourceStop', resource)
end)

-- An event that is triggered after a resource has stopped.
AddEventHandler('onServerResourceStop', function(resource)
    reportResourceEvent('onServerResourceStop', resource)
end)

-- CreateThread(function()
--     blabla
-- end)

-- !NC - ScanResourceRoot test (runs in server/resource context)
-- NOTE: Disabled - causes SIGSEGV crash on some artifact builds
-- CreateThread(function()
--     Wait(5000)
--     -- Hardcoded for testing purposes
--     local resourceRoot = 'D:/Test2/txData/ESXLegacy_CDDBA8.base/resources/'
--     print('[ScanTest] Scanning from SERVER context: ' .. resourceRoot)
--     local startTime = GetGameTimer()
--     local ok = ScanResourceRoot(resourceRoot, function(data)
--         local elapsed = GetGameTimer() - startTime
--         print('[ScanTest] Callback fired after ' .. elapsed .. 'ms')
--         print('[ScanTest] type(data): ' .. type(data))
--         local keys = {}
--         for k, _ in pairs(data) do
--             keys[#keys + 1] = k
--         end
--         print('[ScanTest] keys: ' .. json.encode(keys))
--         local jsonData = json.encode(data)
--         local maxLen = 2000
--         if #jsonData > maxLen then
--             print('[ScanTest] Data (' .. #jsonData .. ' bytes, truncated): ' .. jsonData:sub(1, maxLen))
--         else
--             print('[ScanTest] Data: ' .. jsonData)
--         end
--     end)
--     print('[ScanTest] ScanResourceRoot returned: ' .. tostring(ok))
-- end)
