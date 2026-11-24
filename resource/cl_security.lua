-- =============================================
-- cl_security.lua — client side of the sxPanel security module (see sv_security.lua)
-- =============================================
local HEARTBEAT_INTERVAL_MS <const> = 15 * 1000
local HELLO_RETRY_MS <const> = 30 * 1000

local securityNonce = nil
local reportedOnce = {}

--- Reports a client-side security signal to the server (once per kind per session).
--- Global so other monitor client files (e.g. the NUI origin check) can use it.
---@param kind string
---@param info any
function TxSecurityReport(kind, info)
    if reportedOnce[kind] then
        return
    end
    reportedOnce[kind] = true
    TriggerServerEvent('txsv:security:nuiReport', kind, type(info) == 'string' and info:sub(1, 200) or nil)
end

-- Heartbeat: the server issues a nonce, then expects it back periodically.
RegisterNetEvent('txcl:security:nonce', function(nonce)
    if type(nonce) == 'string' then
        securityNonce = nonce
    end
end)

local function collectResources()
    local names = {}
    for i = 0, GetNumResources() - 1 do
        local name = GetResourceByFindIndex(i)
        if name and GetResourceState(name) == 'started' then
            names[#names + 1] = name
        end
    end
    return names
end

CreateThread(function()
    while not NetworkIsSessionStarted() do
        Wait(500)
    end

    -- Handshake (retried until the server answers)
    while not securityNonce do
        TriggerServerEvent('txsv:security:hello')
        local deadline = GetGameTimer() + HELLO_RETRY_MS
        while not securityNonce and GetGameTimer() < deadline do
            Wait(250)
        end
    end

    TriggerServerEvent('txsv:security:resources', collectResources())

    while true do
        TriggerServerEvent('txsv:security:hb', securityNonce)
        Wait(HEARTBEAT_INTERVAL_MS)
    end
end)

-- Resources the server never sent are injected (executors, dumpers, menus)
AddEventHandler('onClientResourceStart', function(resName)
    if securityNonce then
        TriggerServerEvent('txsv:security:resources', { resName })
    end
end)

-- Stopping resources locally is how most dumpers/menus disable protections
AddEventHandler('onClientResourceStop', function(resName)
    TriggerServerEvent('txsv:security:resourceStopped', resName)
end)

-- Reports from the NUI page (devtools detection)
RegisterSecureNuiCallback('securityReport', function(data, cb)
    if type(data) == 'table' and data.kind == 'devtools' then
        TxSecurityReport('devtools')
    end
    cb({})
end)
