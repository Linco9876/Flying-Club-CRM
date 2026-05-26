import React, { useState, useRef } from 'react';
import { Plane, User, EyeOff, Eye, GripVertical, ChevronDown, Settings2 } from 'lucide-react';

export interface ManagedResource {
  id: string;
  name: string;
  type: 'aircraft' | 'instructor';
  status?: string;
}

interface ResourceManagerPanelProps {
  resources: ManagedResource[];
  hiddenIds: Set<string>;
  orderedIds: string[];
  onHide: (id: string) => void;
  onShow: (id: string) => void;
  onReorder: (newOrder: string[]) => void;
}

export const ResourceManagerPanel: React.FC<ResourceManagerPanelProps> = ({
  resources,
  hiddenIds,
  orderedIds,
  onHide,
  onShow,
  onReorder,
}) => {
  const [open, setOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragNode = useRef<HTMLDivElement | null>(null);

  const visibleResources = orderedIds
    .map(id => resources.find(r => r.id === id))
    .filter((r): r is ManagedResource => !!r && !hiddenIds.has(r.id));

  const hiddenResources = resources.filter(r => hiddenIds.has(r.id));

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    dragNode.current = e.currentTarget as HTMLDivElement;
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== draggingId) {
      setDragOverId(id);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggingId || draggingId === targetId) return;

    const newOrder = [...orderedIds];
    const fromIdx = newOrder.indexOf(draggingId);
    const toIdx = newOrder.indexOf(targetId);

    if (fromIdx === -1 || toIdx === -1) return;

    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggingId);

    onReorder(newOrder);
    setDraggingId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
  };

  const hiddenCount = hiddenResources.length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center space-x-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${
          open
            ? 'bg-gray-900 text-white border-gray-900'
            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
        }`}
        title="Manage resources"
      >
        <Settings2 className="h-4 w-4" />
        <span className="hidden sm:inline">Resources</span>
        {hiddenCount > 0 && (
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${open ? 'bg-white text-gray-900' : 'bg-amber-100 text-amber-700'}`}>
            {hiddenCount}
          </span>
        )}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />

          <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-200 z-40 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <p className="text-sm font-semibold text-gray-900">Manage Resources</p>
              <p className="text-xs text-gray-500 mt-0.5">Drag to reorder, click eye to hide</p>
            </div>

            {/* Visible resources — draggable */}
            <div className="p-2 space-y-1 max-h-64 overflow-y-auto">
              {visibleResources.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-3">All resources are hidden</p>
              )}
              {visibleResources.map(resource => (
                <div
                  key={resource.id}
                  draggable
                  onDragStart={e => handleDragStart(e, resource.id)}
                  onDragOver={e => handleDragOver(e, resource.id)}
                  onDrop={e => handleDrop(e, resource.id)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-grab active:cursor-grabbing select-none transition-colors ${
                    draggingId === resource.id
                      ? 'opacity-40 bg-gray-100'
                      : dragOverId === resource.id
                      ? 'bg-blue-50 border border-blue-300'
                      : 'hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0" />
                  <div className={`p-1 rounded ${resource.type === 'aircraft' ? 'bg-blue-100' : 'bg-emerald-100'}`}>
                    {resource.type === 'aircraft'
                      ? <Plane className="h-3.5 w-3.5 text-blue-600" />
                      : <User className="h-3.5 w-3.5 text-emerald-600" />
                    }
                  </div>
                  <span className="flex-1 text-sm text-gray-800 font-medium truncate">{resource.name}</span>
                  {resource.status && resource.status !== 'serviceable' && (
                    <span className="text-xs text-red-500 capitalize">{resource.status}</span>
                  )}
                  <button
                    onClick={() => onHide(resource.id)}
                    className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Hide resource"
                  >
                    <EyeOff className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Hidden resources section */}
            {hiddenCount > 0 && (
              <>
                <div className="border-t border-gray-100">
                  <button
                    onClick={() => setShowHidden(s => !s)}
                    className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <EyeOff className="h-3.5 w-3.5" />
                      Hidden ({hiddenCount})
                    </span>
                    <ChevronDown className={`h-3 w-3 transition-transform ${showHidden ? 'rotate-180' : ''}`} />
                  </button>

                  {showHidden && (
                    <div className="p-2 space-y-1 max-h-40 overflow-y-auto bg-gray-50">
                      {hiddenResources.map(resource => (
                        <div
                          key={resource.id}
                          className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-white transition-colors border border-transparent"
                        >
                          <div className={`p-1 rounded ${resource.type === 'aircraft' ? 'bg-blue-100' : 'bg-emerald-100'} opacity-50`}>
                            {resource.type === 'aircraft'
                              ? <Plane className="h-3.5 w-3.5 text-blue-600" />
                              : <User className="h-3.5 w-3.5 text-emerald-600" />
                            }
                          </div>
                          <span className="flex-1 text-sm text-gray-400 truncate">{resource.name}</span>
                          <button
                            onClick={() => onShow(resource.id)}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors"
                            title="Show resource"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
