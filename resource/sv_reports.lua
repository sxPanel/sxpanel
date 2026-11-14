-- =============================================
-- sv_reports.lua — Server-side report system handler
-- =============================================
if not TX_SERVER_MODE then
    return
end
-- sv_main.lua bails out early on manual monitor restarts (erased luaComToken)
-- and never defines TX_EVENT_HANDLERS — bail out with it instead of erroring.
if type(TX_EVENT_HANDLERS) ~= 'table' then
    return
end

local reportIntercomUrl = 'http://' .. TX_LUACOMHOST .. '/intercom/'

local validReportStatuses = {
    ['open'] = true,
    ['inReview'] = true,
    ['resolved'] = true,
}

--- Helper to make intercom HTTP requests
---@param scope string
---@param payload table
---@param callback function
local function intercomRequest(scope, payload, callback)
    payload.txAdminToken = TX_LUACOMTOKEN
    PerformHttpRequest(reportIntercomUrl .. scope, function(httpCode, data, resultHeaders)
        if httpCode ~= 200 then
            TxPrintError(('[Reports] intercom/%s failed with code %s'):format(scope, httpCode))
            callback(nil)
            return
        end
        local parsed = json.decode(data)
        callback(parsed)
    end, 'POST', json.encode(payload), { ['Content-Type'] = 'application/json' })
end

--- Gets the player license from their identifiers
---@param src number
---@return string|nil
local function getPlayerLicense(src)
    local identifiers = GetPlayerIdentifiers(src)
    for _, id in ipairs(identifiers) do
        if string.sub(id, 1, 8) == 'license:' then
            return id
        end
    end
    return nil
end

-- Rate limit for report submissions (per player, cleared on disconnect)
local REPORT_CREATE_COOLDOWN_MS = 15000
local lastReportCreate = {}

---@param src number
---@return boolean true if the player is still on cooldown
local function isReportCreateRateLimited(src)
    local now = GetGameTimer()
    local last = lastReportCreate[src]
    if last and now - last < REPORT_CREATE_COOLDOWN_MS then
        return true
    end
    lastReportCreate[src] = now
    return false
end

AddEventHandler('playerDropped', function()
    local droppedId = tonumber(source)
    if droppedId then
        lastReportCreate[droppedId] = nil
    end
end)

-- =============================================
-- MARK: NUI Callback Handlers (called from client)
-- =============================================

--- Shared logic for building the player list and fetching open tickets
---@param src number
---@param responseEvent string
---@param disabledErrorEvent string|nil  -- if set, fires this event with an error string; otherwise sends empty data on responseEvent
local function handleReportListRequest(src, responseEvent, disabledErrorEvent)
    if not GetConvarBool('txAdmin-reportsEnabled') then
        if disabledErrorEvent then
            return TriggerClientEvent(disabledErrorEvent, src, { error = 'Reports are disabled on this server.' })
        else
            return TriggerClientEvent(responseEvent, src, { players = {}, reports = {} })
        end
    end
    local license = getPlayerLicense(src)

    -- Build full server player list (excluding the reporter)
    local players = {}
    for _, serverID in pairs(GetPlayers()) do
        local sid = tonumber(serverID)
        if sid and sid ~= src then
            table.insert(players, {
                id = sid,
                name = GetPlayerName(serverID) or 'Unknown',
            })
        end
    end

    if not license then
        return TriggerClientEvent(responseEvent, src, { players = players, reports = {} })
    end

    intercomRequest('reportPlayerList', {
        playerLicense = license,
    }, function(result)
        local reports = (result and result.reports) or {}
        TriggerClientEvent(responseEvent, src, { players = players, reports = reports })
    end)
end

--- Handle /report command — returns player list + open tickets
RegisterNetEvent('txsv:reportOpen', function()
    local src = source
    handleReportListRequest(src, 'txcl:reportOpenData', 'txcl:reportResult')
end)

--- Handle reports tab opened in NUI — returns player list + open tickets
RegisterNetEvent('txsv:reportTabOpen', function()
    local src = source
    handleReportListRequest(src, 'txcl:reportTabData', nil)
end)

--- Handle report creation from client NUI
RegisterNetEvent('txsv:reportCreate', function(data)
    local src = source
    if not GetConvarBool('txAdmin-reportsEnabled') then
        return TriggerClientEvent('txcl:reportResult', src, { error = 'Reports are disabled on this server.' })
    end
    if type(data) ~= 'table' or type(data.type) ~= 'string' or type(data.reason) ~= 'string' then
        return TriggerClientEvent('txcl:reportResult', src, { error = 'Invalid report data.' })
    end
    if isReportCreateRateLimited(src) then
        return TriggerClientEvent('txcl:reportResult', src, { error = 'You are submitting too fast. Please wait a moment and try again.' })
    end

    local license = getPlayerLicense(src)
    if not license then
        return TriggerClientEvent('txcl:reportResult', src, { error = 'Could not identify your license.' })
    end

    local reporter = {
        license = license,
        name = GetPlayerName(src) or 'Unknown',
        netid = src,
    }

    local targets = {}
    if data.type == 'playerReport' then
        local targetIds = data.targetIds
        if type(targetIds) == 'table' then
            for _, tid in ipairs(targetIds) do
                if type(tid) == 'number' and DoesPlayerExist(tid) then
                    local targetLicense = getPlayerLicense(tid)
                    table.insert(targets, {
                        license = targetLicense or 'unknown',
                        name = GetPlayerName(tid) or 'Unknown',
                        netid = tid,
                    })
                end
            end
        end
    end

    intercomRequest('reportCreate', {
        type = data.type,
        reporter = reporter,
        targets = targets,
        reason = data.reason,
    }, function(result)
        if result and result.reportId then
            TriggerClientEvent('txcl:reportResult', src, { success = true, reportId = result.reportId })
        else
            local errMsg = (result and result.error) or 'Failed to create report.'
            TriggerClientEvent('txcl:reportResult', src, { error = errMsg })
        end
    end)
end)

--- Handle fetching player's own reports
RegisterNetEvent('txsv:reportGetMine', function()
    local src = source
    local license = getPlayerLicense(src)
    if not license then
        return TriggerClientEvent('txcl:reportMyList', src, { error = 'Could not identify your license.' })
    end

    intercomRequest('reportPlayerList', {
        playerLicense = license,
    }, function(result)
        if result and result.reports then
            TriggerClientEvent('txcl:reportMyList', src, result)
        else
            local errMsg = (result and result.error) or 'Failed to get reports.'
            TriggerClientEvent('txcl:reportMyList', src, { error = errMsg })
        end
    end)
end)

--- Handle player sending a message on their own report
RegisterNetEvent('txsv:reportPlayerMessage', function(data)
    local src = source
    if type(data) ~= 'table' or type(data.reportId) ~= 'string' or type(data.content) ~= 'string' then
        return TriggerClientEvent('txcl:reportMessageResult', src, { error = 'Invalid message data.' })
    end

    local license = getPlayerLicense(src)
    if not license then
        return TriggerClientEvent('txcl:reportMessageResult', src, { error = 'Could not identify your license.' })
    end

    intercomRequest('reportPlayerMessage', {
        reportId = data.reportId,
        playerLicense = license,
        content = data.content,
    }, function(result)
        if result and result.success then
            TriggerClientEvent('txcl:reportMessageResult', src, { success = true })
        else
            local errMsg = (result and result.error) or 'Failed to send message.'
            TriggerClientEvent('txcl:reportMessageResult', src, { error = errMsg })
        end
    end)
end)

-- =============================================
-- MARK: Event handler for admin notifications
-- =============================================
TX_EVENT_HANDLERS.reportCreated = function(eventData)
    -- Notify all online admins
    for netid, admin in pairs(TX_ADMINS) do
        TriggerClientEvent('txcl:reportNotification', netid, {
            reportId = eventData.reportId,
            type = eventData.type,
            reporterName = eventData.reporterName,
            reason = eventData.reason,
        })
    end
end

-- =============================================
-- MARK: Admin report management (for in-game NUI panel)
-- =============================================

--- Helper: check if an admin has the players.reports permission
local function hasReportsPermission(admin)
    if not admin or not admin.perms then return false end
    for _, perm in pairs(admin.perms) do
        if perm == 'all_permissions' or perm == 'players.reports' then
            return true
        end
    end
    return false
end

--- Admin: list all reports
RegisterNetEvent('txsv:reportAdminList', function()
    local src = source
    local srcString = tostring(src)
    local admin = TX_ADMINS[srcString]
    if not admin then
        TriggerClientEvent('txcl:reportAdminListData', src, { error = 'Not authenticated.' })
        return
    end
    if not hasReportsPermission(admin) then
        TriggerClientEvent('txcl:reportAdminListData', src, { error = 'Permission denied.' })
        return
    end

    intercomRequest('reportAdminList', {
        adminName = admin.username,
    }, function(result)
        TriggerClientEvent('txcl:reportAdminListData', src, result or { error = 'Failed to fetch reports.' })
    end)
end)

--- Admin: get report detail
RegisterNetEvent('txsv:reportAdminDetail', function(reportId)
    local src = source
    local srcString = tostring(src)
    local admin = TX_ADMINS[srcString]
    if not admin then
        TriggerClientEvent('txcl:reportAdminDetailData', src, { error = 'Not authenticated.' })
        return
    end
    if not hasReportsPermission(admin) then
        TriggerClientEvent('txcl:reportAdminDetailData', src, { error = 'Permission denied.' })
        return
    end
    if type(reportId) ~= 'string' then
        TriggerClientEvent('txcl:reportAdminDetailData', src, { error = 'Invalid report ID.' })
        return
    end

    intercomRequest('reportAdminDetail', {
        adminName = admin.username,
        reportId = reportId,
    }, function(result)
        TriggerClientEvent('txcl:reportAdminDetailData', src, result or { error = 'Failed to fetch report.' })
    end)
end)

--- Admin: send message to a report
RegisterNetEvent('txsv:reportAdminMessage', function(data)
    local src = source
    local srcString = tostring(src)
    local admin = TX_ADMINS[srcString]
    if not admin then
        TriggerClientEvent('txcl:reportAdminMessageResult', src, { error = 'Not authorized.' })
        return
    end
    if not hasReportsPermission(admin) then
        TriggerClientEvent('txcl:reportAdminMessageResult', src, { error = 'Permission denied.' })
        return
    end
    if type(data) ~= 'table' or type(data.reportId) ~= 'string' or type(data.content) ~= 'string' then
        TriggerClientEvent('txcl:reportAdminMessageResult', src, { error = 'Invalid payload.' })
        return
    end
    if #data.content > 2048 then
        TriggerClientEvent('txcl:reportAdminMessageResult', src, { error = 'Content too long.' })
        return
    end

    intercomRequest('reportAdminMessage', {
        adminName = admin.username,
        reportId = data.reportId,
        content = data.content,
    }, function(result)
        TriggerClientEvent('txcl:reportAdminMessageResult', src, result or { error = 'Failed to send message.' })
    end)
end)

--- Admin: change report status
RegisterNetEvent('txsv:reportAdminStatus', function(data)
    local src = source
    local srcString = tostring(src)
    local admin = TX_ADMINS[srcString]
    if not admin then
        TriggerClientEvent('txcl:reportAdminStatusResult', src, { error = 'Not authorized.' })
        return
    end
    if not hasReportsPermission(admin) then
        TriggerClientEvent('txcl:reportAdminStatusResult', src, { error = 'Permission denied.' })
        return
    end
    if type(data) ~= 'table' or type(data.reportId) ~= 'string' or type(data.status) ~= 'string' then
        TriggerClientEvent('txcl:reportAdminStatusResult', src, { error = 'Invalid payload.' })
        return
    end
    if not validReportStatuses[data.status] then
        TriggerClientEvent('txcl:reportAdminStatusResult', src, { error = 'Invalid payload.' })
        return
    end

    intercomRequest('reportAdminStatus', {
        adminName = admin.username,
        reportId = data.reportId,
        status = data.status,
    }, function(result)
        TriggerClientEvent('txcl:reportAdminStatusResult', src, result or { error = 'Failed to update status.' })
    end)
end)
