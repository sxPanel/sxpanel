-- Copyright (C) 2026 enty@pocus.software. LGPL-3.0-or-later, see LICENSE.
-- Vendored from https://github.com/PocusSoftware/telemetry (client/hook.lua @ 246f562), unmodified.

local RESOURCE <const> = GetCurrentResourceName()
local EVENT <const> = 'telemetry:clientError'
local MAX_LEN <const> = 2000
local COOLDOWN <const> = 1000 ---@type integer ms

local lastSent = -COOLDOWN ---@type integer

local rawAddEventHandler <const> = AddEventHandler
local rawRegisterNetEvent <const> = RegisterNetEvent
local rawRegisterCommand <const> = RegisterCommand
local rawCreateThread <const> = CreateThread
local rawSetTimeout <const> = SetTimeout

---@param err any
---@return string
local function traceback(err)
    return debug.traceback(type(err) == 'table' and json.encode(err) or tostring(err), 2)
end

---@param trace string
local function report(trace)
    Citizen.Trace(('^1SCRIPT ERROR: %s^7\n'):format(trace))

    local now <const> = GetGameTimer()
    if now - lastSent < COOLDOWN then return end
    lastSent = now

    TriggerServerEvent(EVENT, { resource = RESOURCE, trace = trace:sub(1, MAX_LEN) })
end

local function finish(ok, ...)
    if not ok then return report((...)) end
    return ...
end

---@param fn any
---@return any
local function wrap(fn)
    if type(fn) ~= 'function' then return fn end
    return function(...)
        return finish(xpcall(fn, traceback, ...))
    end
end

_G.AddEventHandler = function(name, fn)
    return rawAddEventHandler(name, wrap(fn))
end

_G.RegisterNetEvent = function(name, fn)
    if fn then return rawRegisterNetEvent(name, wrap(fn)) end
    return rawRegisterNetEvent(name)
end

_G.RegisterCommand = function(name, fn, restricted)
    return rawRegisterCommand(name, wrap(fn), restricted)
end

_G.CreateThread = function(fn)
    return rawCreateThread(wrap(fn))
end
Citizen.CreateThread = _G.CreateThread

_G.SetTimeout = function(ms, fn)
    return rawSetTimeout(ms, wrap(fn))
end
