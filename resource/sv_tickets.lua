-- =============================================
-- sv_tickets.lua — Server-side ticket system handler
-- =============================================
if not TX_SERVER_MODE then
    return
end

local intercomUrl = 'http://' .. TX_LUACOMHOST .. '/intercom/'

local validTicketStatuses = {
    ['open'] = true,
    ['inReview'] = true,
    ['resolved'] = true,
    ['closed'] = true,
}

--- Helper to make intercom HTTP requests
---@param scope string
---@param payload table
---@param callback function
local function intercomRequest(scope, payload, callback)
    payload.txAdminToken = TX_LUACOMTOKEN
    PerformHttpRequest(intercomUrl .. scope, function(httpCode, data, resultHeaders)
        if httpCode ~= 200 then
            TxPrintError(('[Tickets] intercom/%s failed with code %s'):format(scope, httpCode))
            callback(nil)
            return
        end
        local parsed = json.decode(data)
        callback(parsed)
    end, 'POST', json.encode(payload), { ['Content-Type'] = 'application/json' })
end

--- Gets a specific identifier (by prefix) from a player's identifiers
---@param src number
---@param prefix string
---@return string|nil
local function getPlayerIdentifierByPrefix(src, prefix)
    local identifiers = GetPlayerIdentifiers(src)
    for _, id in ipairs(identifiers) do
        if string.sub(id, 1, #prefix) == prefix then
            return id
        end
    end
    return nil
end

--- Gets the player license from identifiers
---@param src number
---@return string|nil
local function getPlayerLicense(src)
    return getPlayerIdentifierByPrefix(src, 'license:')
end

--- Gets the player discord identifier from identifiers
---@param src number
---@return string|nil
local function getPlayerDiscord(src)
    return getPlayerIdentifierByPrefix(src, 'discord:')
end

-- Rate limit for ticket submissions (per player, cleared on disconnect)
local TICKET_CREATE_COOLDOWN_MS = 15000
local lastTicketCreate = {}

---@param src number
---@return boolean true if the player is still on cooldown
local function isTicketCreateRateLimited(src)
    local now = GetGameTimer()
    local last = lastTicketCreate[src]
    if last and now - last < TICKET_CREATE_COOLDOWN_MS then
        return true
    end
    lastTicketCreate[src] = now
    return false
end

AddEventHandler('playerDropped', function()
    local droppedId = tonumber(source)
    if droppedId then
        lastTicketCreate[droppedId] = nil
    end
end)

--- Check if admin has players.reports permission
---@param admin table
---@return boolean
local function hasReportsPermission(admin)
    if not admin or not admin.perms then return false end
    for _, perm in pairs(admin.perms) do
        if perm == 'all_permissions' or perm == 'players.reports' then
            return true
        end
    end
    return false
end

--- Get ticket categories from convar (comma-separated)
---@return table
local function getTicketCategories()
    local raw = GetConvar('txAdmin-ticketCategories', 'Player Report,Bug Report,Question,Other')
    local categories = {}
    for cat in raw:gmatch('[^,]+') do
        local trimmed = cat:match('^%s*(.-)%s*$')
        if #trimmed > 0 then
            table.insert(categories, trimmed)
        end
    end
    return categories
end

--- Checks whether a ticket category is a player-vs-player style report
---@param category string
---@return boolean
local function isPlayerReportCategory(category)
    return string.find(category:lower(), 'player', 1, true) ~= nil
end

local NEARBY_PLAYERS_MAX = 10

--- Finds players near the reporter at submission time (used for player reports)
---@param src number
---@param excludeNetIds table<number, boolean>
---@return table
local function findNearbyPlayers(src, excludeNetIds)
    local nearby = {}
    local srcPed = GetPlayerPed(src)
    if not srcPed or srcPed == 0 then return nearby end

    local srcCoords = GetEntityCoords(srcPed)
    local radius = GetConvarInt('txAdmin-ticketNearbyDistance', 20)

    for _, serverId in ipairs(GetPlayers()) do
        local sid = tonumber(serverId)
        if sid and sid ~= src and not excludeNetIds[sid] then
            local targetPed = GetPlayerPed(serverId)
            if targetPed and targetPed ~= 0 then
                local dist = #(srcCoords - GetEntityCoords(targetPed))
                if dist <= radius then
                    table.insert(nearby, {
                        license = getPlayerLicense(sid) or 'unknown',
                        discord = getPlayerDiscord(sid),
                        name = GetPlayerName(sid) or 'Unknown',
                        netid = sid,
                    })
                    if #nearby >= NEARBY_PLAYERS_MAX then break end
                end
            end
        end
    end
    return nearby
end

--- Build the full player list (excluding caller)
---@param src number
---@return table
local function buildPlayerList(src)
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
    return players
end

-- =============================================
-- MARK: Player: Open ticket UI ("txsv:ticketOpen")
-- =============================================

RegisterNetEvent('txsv:ticketOpen', function()
    local src = source
    if not GetConvarBool('txAdmin-reportsEnabled') then
        return TriggerClientEvent('txcl:ticketResult', src, { error = 'nui_reports.server.tickets_disabled' })
    end

    local license = getPlayerLicense(src)
    local players = buildPlayerList(src)
    local categories = getTicketCategories()
    local priorityEnabled = GetConvarBool('txAdmin-ticketPriorityEnabled')

    if not license then
        return TriggerClientEvent('txcl:ticketOpenData', src, {
            players = players,
            tickets = {},
            categories = categories,
            priorityEnabled = priorityEnabled,
        })
    end

    intercomRequest('ticketPlayerList', {
        playerLicense = license,
    }, function(result)
        local tickets = (result and result.tickets) or {}
        TriggerClientEvent('txcl:ticketOpenData', src, {
            players = players,
            tickets = tickets,
            categories = categories,
            priorityEnabled = priorityEnabled,
        })
    end)
end)

-- =============================================
-- MARK: Player: Submit new ticket ("txsv:ticketCreate")
-- =============================================

RegisterNetEvent('txsv:ticketCreate', function(data)
    local src = source
    if not GetConvarBool('txAdmin-reportsEnabled') then
        return TriggerClientEvent('txcl:ticketResult', src, { error = 'nui_reports.server.tickets_disabled' })
    end
    if type(data) ~= 'table'
        or type(data.category) ~= 'string'
        or type(data.description) ~= 'string'
        or #data.description == 0
    then
        return TriggerClientEvent('txcl:ticketResult', src, { error = 'nui_reports.errors.invalid_ticket_data' })
    end
    if isTicketCreateRateLimited(src) then
        return TriggerClientEvent('txcl:ticketResult', src, { error = 'nui_reports.errors.rate_limited' })
    end

    local license = getPlayerLicense(src)
    if not license then
        return TriggerClientEvent('txcl:ticketResult', src, { error = 'nui_reports.server.could_not_identify' })
    end

    local reporter = {
        license = license,
        discord = getPlayerDiscord(src),
        name = GetPlayerName(src) or 'Unknown',
        netid = src,
    }

    -- Resolve targets (only when submitting a player report)
    local targets = {}
    local excludeNetIds = { [src] = true }
    if type(data.targetIds) == 'table' then
        for _, tid in ipairs(data.targetIds) do
            if type(tid) == 'number' and DoesPlayerExist(tid) then
                table.insert(targets, {
                    license = getPlayerLicense(tid) or 'unknown',
                    discord = getPlayerDiscord(tid),
                    name = GetPlayerName(tid) or 'Unknown',
                    netid = tid,
                })
                excludeNetIds[tid] = true
            end
        end
    end

    -- Automatically capture nearby players' IDs for player-vs-player reports, to help staff investigate
    local nearbyPlayers = {}
    if isPlayerReportCategory(data.category) then
        nearbyPlayers = findNearbyPlayers(src, excludeNetIds)
    end

    local payload = {
        reporter = reporter,
        targets = targets,
        nearbyPlayers = nearbyPlayers,
        category = data.category,
        description = data.description:sub(1, 2048),
    }

    if GetConvarBool('txAdmin-ticketPriorityEnabled') and type(data.priority) == 'string' then
        payload.priority = data.priority
    end

    intercomRequest('ticketCreate', payload, function(result)
        if result and result.ticketId then
            TriggerClientEvent('txcl:ticketResult', src, { success = true, ticketId = result.ticketId })
        else
            local errMsg = (result and result.error) or 'Failed to create ticket.'
            TriggerClientEvent('txcl:ticketResult', src, { error = errMsg })
        end
    end)
end)

-- =============================================
-- MARK: Player: Fetch my tickets ("txsv:ticketGetMine")
-- =============================================

RegisterNetEvent('txsv:ticketGetMine', function()
    local src = source
    local license = getPlayerLicense(src)
    if not license then
        return TriggerClientEvent('txcl:ticketMyList', src, { error = 'nui_reports.server.could_not_identify' })
    end

    intercomRequest('ticketPlayerList', { playerLicense = license }, function(result)
        if result and result.tickets then
            TriggerClientEvent('txcl:ticketMyList', src, result)
        else
            local errMsg = (result and result.error) or 'Failed to get tickets.'
            TriggerClientEvent('txcl:ticketMyList', src, { error = errMsg })
        end
    end)
end)

-- =============================================
-- MARK: Player: Send message on ticket ("txsv:ticketPlayerMessage")
-- =============================================

RegisterNetEvent('txsv:ticketPlayerMessage', function(data)
    local src = source
    if type(data) ~= 'table' or type(data.ticketId) ~= 'string' or type(data.content) ~= 'string' then
        return TriggerClientEvent('txcl:ticketMessageResult', src, { error = 'nui_reports.errors.invalid_message_data' })
    end

    local hasContent = data.content ~= ''
    local hasImages = type(data.imageUrls) == 'table' and #data.imageUrls > 0
    if not hasContent and not hasImages then
        return TriggerClientEvent('txcl:ticketMessageResult', src, { error = 'nui_reports.errors.message_required' })
    end

    local license = getPlayerLicense(src)
    if not license then
        return TriggerClientEvent('txcl:ticketMessageResult', src, { error = 'nui_reports.server.could_not_identify' })
    end

    local reqData = {
        ticketId = data.ticketId,
        playerLicense = license,
        content = data.content:sub(1, 2048),
    }

    if hasImages then
        reqData.imageUrls = {}
        for i, url in ipairs(data.imageUrls) do
            if i > 3 then break end
            if type(url) == 'string' then
                local trimmed = url:match('^%s*(.-)%s*$')
                if #trimmed > 0 and #trimmed <= 2048 and trimmed:match('^https://') then
                    table.insert(reqData.imageUrls, trimmed)
                end
            end
        end
    end

    intercomRequest('ticketPlayerMessage', reqData, function(result)
        if result and result.success then
            TriggerClientEvent('txcl:ticketMessageResult', src, { success = true })
        else
            local errMsg = (result and result.error) or 'Failed to send message.'
            TriggerClientEvent('txcl:ticketMessageResult', src, { error = errMsg })
        end
    end)
end)

-- =============================================
-- MARK: Player: Submit feedback ("txsv:ticketFeedback")
-- =============================================

RegisterNetEvent('txsv:ticketFeedback', function(data)
    local src = source
    if type(data) ~= 'table' or type(data.ticketId) ~= 'string' or type(data.rating) ~= 'number' then
        TriggerClientEvent('txcl:ticketFeedbackResult', src, { success = false, error = 'validation_failed' })
        return
    end

    local license = getPlayerLicense(src)
    if not license then
        TriggerClientEvent('txcl:ticketFeedbackResult', src, { success = false, error = 'no_license' })
        return
    end

    intercomRequest('ticketFeedbackSubmit', {
        ticketId = data.ticketId,
        reporterLicense = license,
        rating = math.floor(math.max(1, math.min(5, data.rating))),
        comment = type(data.comment) == 'string' and data.comment:sub(1, 512) or nil,
    }, function(result)
        if result and result.success then
            TriggerClientEvent('txcl:ticketFeedbackResult', src, { success = true })
        else
            local errMsg = (result and result.error) or 'Failed to submit feedback.'
            TriggerClientEvent('txcl:ticketFeedbackResult', src, { success = false, error = errMsg })
        end
    end)
end)

-- =============================================
-- MARK: Menu tab open (admin NUI "txsv:ticketTabOpen")
-- =============================================

RegisterNetEvent('txsv:ticketTabOpen', function()
    local src = source
    local categories = getTicketCategories()
    local players = buildPlayerList(src)
    -- send basic data immediately; admin will fetch full list via ticketAdminList
    TriggerClientEvent('txcl:ticketTabData', src, { players = players, categories = categories })
end)

-- =============================================
-- MARK: Admin: List all tickets
-- =============================================

RegisterNetEvent('txsv:ticketAdminList', function()
    local src = source
    local srcString = tostring(src)
    local admin = TX_ADMINS[srcString]
    if not admin or not hasReportsPermission(admin) then
        TriggerClientEvent('txcl:ticketAdminListData', src, { error = 'nui_reports.server.permission_denied' })
        return
    end

    intercomRequest('ticketAdminList', { adminName = admin.username }, function(result)
        TriggerClientEvent('txcl:ticketAdminListData', src, result or { error = 'nui_reports.server.failed_fetch' })
    end)
end)

-- =============================================
-- MARK: Admin: Get ticket detail
-- =============================================

RegisterNetEvent('txsv:ticketAdminDetail', function(ticketId)
    local src = source
    local srcString = tostring(src)
    local admin = TX_ADMINS[srcString]
    if not admin or not hasReportsPermission(admin) then
        TriggerClientEvent('txcl:ticketAdminDetailData', src, { error = 'nui_reports.server.permission_denied' })
        return
    end
    if type(ticketId) ~= 'string' then
        TriggerClientEvent('txcl:ticketAdminDetailData', src, { error = 'nui_reports.errors.invalid_ticket_id' })
        return
    end

    intercomRequest('ticketAdminDetail', {
        adminName = admin.username,
        ticketId = ticketId,
    }, function(result)
        TriggerClientEvent('txcl:ticketAdminDetailData', src, result or { error = 'nui_reports.server.failed_fetch_ticket' })
    end)
end)

-- =============================================
-- MARK: Admin: Send message on ticket
-- =============================================

RegisterNetEvent('txsv:ticketAdminMessage', function(data)
    local src = source
    local srcString = tostring(src)
    local admin = TX_ADMINS[srcString]
    if not admin or not hasReportsPermission(admin) then
        TriggerClientEvent('txcl:ticketAdminMessageResult', src, { error = 'Permission denied.' })
        return
    end
    if type(data) ~= 'table' or type(data.ticketId) ~= 'string' then
        TriggerClientEvent('txcl:ticketAdminMessageResult', src, { error = 'Invalid payload.' })
        return
    end

    local hasContent = type(data.content) == 'string' and data.content ~= '' and not data.content:match('^%s*$')
    local hasImages = type(data.imageUrls) == 'table' and #data.imageUrls > 0
    if not hasContent and not hasImages then
        TriggerClientEvent('txcl:ticketAdminMessageResult', src, { error = 'Invalid payload.' })
        return
    end

    local reqData = {
        adminName = admin.username,
        ticketId = data.ticketId,
        content = hasContent and data.content:sub(1, 2048) or '',
    }

    if hasImages then
        reqData.imageUrls = {}
        for i, url in ipairs(data.imageUrls) do
            if i > 3 then break end
            if type(url) == 'string' then
                local trimmed = url:match('^%s*(.-)%s*$')
                if #trimmed > 0 and #trimmed <= 2048 and trimmed:match('^https://') then
                    table.insert(reqData.imageUrls, trimmed)
                end
            end
        end
    end

    intercomRequest('ticketAdminMessage', reqData, function(result)
        if result and result.success then
            TriggerClientEvent('txcl:ticketAdminMessageResult', src, { success = true })
        else
            local errMsg = (result and result.error) or 'Failed to send message.'
            TriggerClientEvent('txcl:ticketAdminMessageResult', src, { error = errMsg })
        end
    end)
end)

-- =============================================
-- MARK: Admin: Change ticket status
-- =============================================

RegisterNetEvent('txsv:ticketAdminStatus', function(data)
    local src = source
    local srcString = tostring(src)
    local admin = TX_ADMINS[srcString]
    if not admin or not hasReportsPermission(admin) then
        TriggerClientEvent('txcl:ticketAdminStatusResult', src, { error = 'Permission denied.' })
        return
    end
    if type(data) ~= 'table' or type(data.ticketId) ~= 'string' or type(data.status) ~= 'string' then
        TriggerClientEvent('txcl:ticketAdminStatusResult', src, { error = 'Invalid payload.' })
        return
    end
    if not validTicketStatuses[data.status] then
        TriggerClientEvent('txcl:ticketAdminStatusResult', src, { error = 'Invalid status.' })
        return
    end

    intercomRequest('ticketAdminStatus', {
        adminName = admin.username,
        ticketId = data.ticketId,
        status = data.status,
    }, function(result)
        if result and result.success then
            TriggerClientEvent('txcl:ticketAdminStatusResult', src, { success = true })
        else
            local errMsg = (result and result.error) or 'Failed to update status.'
            TriggerClientEvent('txcl:ticketAdminStatusResult', src, { error = errMsg })
        end
    end)
end)

-- =============================================
-- MARK: Admin notifications on ticket creation
-- =============================================

TX_EVENT_HANDLERS.ticketCreated = function(eventData)
    for netid, admin in pairs(TX_ADMINS) do
        if hasReportsPermission(admin) then
            local playerId = tonumber(netid)
            if playerId then
                TriggerClientEvent('txcl:ticketNotification', playerId, {
                    ticketId = eventData.ticketId,
                    category = eventData.category,
                    reporterName = eventData.reporterName,
                    description = eventData.description,
                })
            end
        end
    end
end

-- =============================================
-- MARK: Push new message to reporter in-game
-- =============================================

TX_EVENT_HANDLERS.ticketNewMessage = function(eventData)
    local targetLicense = eventData.reporterLicense
    if type(targetLicense) ~= 'string' then return end
    for _, serverId in pairs(GetPlayers()) do
        local identifiers = GetPlayerIdentifiers(serverId)
        for _, id in ipairs(identifiers) do
            if id == targetLicense then
                TriggerClientEvent('txcl:ticketNewMessage', tonumber(serverId), {
                    ticketId = eventData.ticketId,
                    message = eventData.message,
                })
                break
            end
        end
    end
end

-- =============================================
-- MARK: Player: Fetch messages for a ticket ("txsv:ticketFetchMessages")
-- =============================================

RegisterNetEvent('txsv:ticketFetchMessages', function(ticketId)
    local src = source
    local license = getPlayerLicense(src)
    if not license then
        TriggerClientEvent('txcl:ticketMessages', src, { error = 'Could not identify your license.' })
        return
    end
    if type(ticketId) ~= 'string' then
        TriggerClientEvent('txcl:ticketMessages', src, { error = 'Invalid ticket ID.' })
        return
    end

    intercomRequest('ticketPlayerMessages', {
        ticketId = ticketId,
        playerLicense = license,
    }, function(result)
        TriggerClientEvent('txcl:ticketMessages', src, result or { error = 'Failed to fetch messages.' })
    end)
end)
