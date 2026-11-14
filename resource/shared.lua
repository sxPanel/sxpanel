-- =============================================
--  Truly global
-- =============================================

--- The actual resource name at runtime: 'monitor' on gen8, 'txadmin' on FXServer gen9
--- (FiveM Enhanced) - not hardcoded, since it varies by generation. Used instead of a literal
--- wherever a native call needs the resource's own name (LoadResourceFile, etc).
TX_RESOURCE_NAME = GetCurrentResourceName()

function GetConvarBool(cvName, defaultConvarValue)
    if not cvName then
        return false
    elseif defaultConvarValue then
        return (GetConvar(cvName, 'true') == 'true')
    else
        return (GetConvar(cvName, 'false') == 'true')
    end
end

-- -- Tests for GetConvarBool
-- print("==========================")
-- print('unknown convar')
-- print(GetConvarBool2('xxx', true)) -- true
-- print(GetConvarBool2('xxx', false)) -- false
-- print(GetConvarBool2('xxx')) -- false
-- print('known convar')
-- SetConvar('yyy', 'true')
-- print(GetConvarBool2('yyy', true)) -- true
-- print(GetConvarBool2('yyy', false)) -- true
-- print(GetConvarBool2('yyy')) -- true
-- print('known convar, but with a false value')
-- SetConvar('yyy', 'false')
-- print(GetConvarBool2('yyy', false)) -- false
-- print(GetConvarBool2('yyy', true)) -- false
-- print(GetConvarBool2('yyy')) -- false
-- print("==========================")

-- Setting game-specific global vars
local envName = GetGameName()
if envName == 'fxserver' then
    local gameConvar = GetConvar('gamename', 'gta5')
    GAME_NAME = gameConvar == 'gta5' and 'fivem' or 'redm'
else
    GAME_NAME = envName
end
IS_FIVEM = GAME_NAME == 'fivem'
IS_REDM = GAME_NAME == 'redm'

-- Setting global enable/disable variable for all sv_*.lua files
-- NOTE: not available on client
TX_SERVER_MODE = GetConvarBool('txAdminServerMode')

-- Setting global enable/disable variable for all menu-related files
TX_MENU_ENABLED = GetConvarBool('txAdmin-menuEnabled')

-- Setting global debug variable for all files
-- On the client, this is updated by receiving a `txcl:setDebugMode` event.
-- On the server, this is updated by running txaSetDebugMode on Live Console
TX_DEBUG_MODE = GetConvarBool('txAdmin-debugMode')

--- Internal helper to format txAdmin console messages
local function _formatTxString(args)
    local appendedStr = ''
    for _, v in ipairs(args) do
        appendedStr = appendedStr .. ' ' .. (type(v) == 'table' and json.encode(v) or tostring(v))
    end
    return appendedStr
end

--- Prints formatted string to console
function TxPrint(...)
    local msg = ('^5[sxPanel]^0%s^0'):format(_formatTxString({ ... }))
    print(msg)
end

function TxPrintError(...)
    local msg = ('^5[sxPanel]^1%s^0'):format(_formatTxString({ ... }))
    print(msg)
end

--- Prints formatted string to console if debug mode is enabled
function DebugPrint(...)
    if TX_DEBUG_MODE then
        TxPrint(...)
    end
end

--- Resolves the author label used for bridged admin actions.
function TxAdminActionAuthor(admin)
    if type(admin) ~= 'table' then
        return 'unknown'
    end
    return admin.username or 'unknown'
end

--- Finds the index of a table element
---@param tgtTable table
---@param value any
---@return integer
function TableIndexOf(tgtTable, value)
    for i = 1, #tgtTable do
        DebugPrint(('tgtTableVal: %s, value: %s'):format(tgtTable[i], value))
        if tgtTable[i] == value then
            return i
        end
    end
    return -1
end

---Shortcut for calculating a ped % health
---@param ped any
---@return integer
function GetPedHealthPercent(ped)
    return math.floor((GetEntityHealth(ped) / GetEntityMaxHealth(ped)) * 100)
end

-- =============================================
--  Locale translation (loads locale/*.json)
-- =============================================
translator = {}

local _translatorLocale = nil
local _translatorLang = nil

local function _translatorLoadLocale()
    local lang = GetConvar('txAdmin-locale', 'en')
    if lang == _translatorLang and _translatorLocale then
        return _translatorLocale
    end

    local fileData
    if lang == 'custom' then
        fileData = LoadResourceFile(TX_RESOURCE_NAME, '.runtime/locale.json')
    else
        fileData = LoadResourceFile(TX_RESOURCE_NAME, 'locale/' .. lang .. '.json')
    end

    if type(fileData) ~= 'string' then
        return nil
    end

    _translatorLocale = json.decode(fileData)
    _translatorLang = lang
    return _translatorLocale
end

local function _translatorResolve(phrases, key)
    local node = phrases
    for part in string.gmatch(key, '[^%.]+') do
        if type(node) ~= 'table' then
            return nil
        end
        node = node[part]
    end
    if type(node) == 'string' then
        return node
    end
    return nil
end

local function _translatorInterpolate(str, options)
    if type(options) ~= 'table' then
        return str
    end
    return (str:gsub('%%{([^}]+)}', function(k)
        local v = options[k]
        if v == nil then
            return '%{' .. k .. '}'
        end
        return tostring(v)
    end))
end

---@param key string Dot-separated locale key (e.g. nui_menu.keybinds.open_main)
---@param options table|nil Interpolation values for %{name} placeholders
---@return string
function translator.t(key, options)
    if type(key) ~= 'string' then
        return tostring(key)
    end
    local locale = _translatorLoadLocale()
    if not locale then
        return key
    end
    local value = _translatorResolve(locale, key)
    if not value then
        return key
    end
    return _translatorInterpolate(value, options)
end

AddEventHandler('txAdmin:events:configChanged', function()
    _translatorLocale = nil
    _translatorLang = nil
end)

