import React, { useState } from 'react';
import { Plane, Activity, AlertCircle, Settings, Search, Filter, MapPin, Menu, Bell, ChevronDown, Radio } from 'lucide-react';

export default function FleetCommandRedesign() {
  const [activeTab, setActiveTab] = useState('units');
  
  return (
    <div className="flex h-screen bg-slate-950">
      {/* Sidebar */}
      <div className="w-80 bg-slate-900 border-r border-slate-800 flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-white">Fleet Command</h1>
              <p className="text-sm text-slate-400 mt-1">AST Operations</p>
            </div>
            <button className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
              <Menu className="w-5 h-5 text-slate-400" />
            </button>
          </div>
          
          {/* Connection Status */}
          <div className="flex items-center gap-3 px-4 py-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-emerald-400">System Connected</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 px-6">
          {['units', 'analytics', 'missions'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                activeTab === tab
                  ? 'text-blue-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {activeTab === tab && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />
              )}
            </button>
          ))}
        </div>

        {/* Search and Filter */}
        <div className="p-6 border-b border-slate-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search units..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button className="flex items-center gap-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-750 transition-colors">
              <Filter className="w-3.5 h-3.5" />
              All Status
              <ChevronDown className="w-3 h-3" />
            </button>
            <button className="flex items-center gap-2 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-750 transition-colors">
              Sort: Name
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Units List */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/20">
              <Plane className="w-10 h-10 text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No Units Connected</h3>
            <p className="text-sm text-slate-400 max-w-xs mb-6">
              Waiting for fleet telemetry. Units will appear here once they establish connection.
            </p>
            <button className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
              Refresh Connection
            </button>
          </div>
        </div>

        {/* AI Mission Plan */}
        <div className="p-6 border-t border-slate-800">
          <button className="w-full px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl font-medium text-sm hover:from-violet-700 hover:to-indigo-700 transition-all shadow-lg shadow-violet-500/20 flex items-center justify-center gap-2">
            <Activity className="w-4 h-4" />
            AI Mission Plan
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <div className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-8">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Radio className="w-4 h-4 text-slate-500" />
                <span className="font-medium text-slate-300">0</span>
                <span className="text-slate-500">active</span>
              </div>
              <div className="w-px h-4 bg-slate-700" />
              <div className="text-sm">
                <span className="font-medium text-slate-300">0</span>
                <span className="text-slate-500"> total units</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="relative px-4 py-2 bg-amber-500/10 text-amber-400 rounded-lg text-sm font-medium hover:bg-amber-500/20 transition-colors flex items-center gap-2 border border-amber-500/20">
              <AlertCircle className="w-4 h-4" />
              24 Alerts
            </button>
            <button className="p-2.5 hover:bg-slate-800 rounded-lg transition-colors relative">
              <Bell className="w-5 h-5 text-slate-400" />
              <div className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
            </button>
            <button className="p-2.5 hover:bg-slate-800 rounded-lg transition-colors">
              <Settings className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Map Area */}
        <div className="flex-1 relative bg-slate-950">
          {/* Map placeholder with subtle grid */}
          <div className="absolute inset-0 opacity-20">
            <svg className="w-full h-full">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgb(71, 85, 105)" strokeWidth="0.5" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          </div>
          
          {/* Center overlay */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <MapPin className="w-8 h-8 text-slate-400" />
              </div>
              <p className="text-slate-200 text-lg font-medium mb-1">Los Angeles</p>
              <p className="text-slate-500 text-sm">Operations Area</p>
            </div>
          </div>

          {/* Map controls */}
          <div className="absolute bottom-8 right-8 flex flex-col gap-2">
            <button className="w-10 h-10 bg-slate-800 border border-slate-700 rounded-lg shadow-lg flex items-center justify-center hover:bg-slate-750 transition-colors">
              <span className="text-lg font-light text-slate-300">+</span>
            </button>
            <button className="w-10 h-10 bg-slate-800 border border-slate-700 rounded-lg shadow-lg flex items-center justify-center hover:bg-slate-750 transition-colors">
              <span className="text-lg font-light text-slate-300">−</span>
            </button>
          </div>

          {/* Location badge */}
          <div className="absolute top-8 left-8 px-4 py-2 bg-slate-800/90 backdrop-blur-sm rounded-full border border-slate-700">
            <span className="text-sm font-medium text-slate-200">Los Angeles, CA</span>
          </div>
        </div>
      </div>
    </div>
  );
}