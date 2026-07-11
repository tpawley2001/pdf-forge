import { useReducer, useCallback, useRef } from 'react';

const initialState = {
  annotations: [],
  undoStack: [],
  redoStack: [],
};

function reducer(state, action) {
  switch (action.type) {
    case 'ADD':
      return {
        annotations: [...state.annotations, action.annotation],
        undoStack: [...state.undoStack, state.annotations],
        redoStack: [],
      };
    case 'REMOVE':
      return {
        annotations: state.annotations.filter(a => a.id !== action.id),
        undoStack: [...state.undoStack, state.annotations],
        redoStack: [],
      };
    case 'UPDATE':
      return {
        annotations: state.annotations.map(a => a.id === action.id ? { ...a, ...action.changes } : a),
        undoStack: [...state.undoStack, state.annotations],
        redoStack: [],
      };
    case 'UNDO': {
      if (state.undoStack.length === 0) return state;
      const previous = state.undoStack[state.undoStack.length - 1];
      return {
        annotations: previous,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.annotations],
      };
    }
    case 'REDO': {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      return {
        annotations: next,
        undoStack: [...state.undoStack, state.annotations],
        redoStack: state.redoStack.slice(0, -1),
      };
    }
    case 'CLEAR':
      return initialState;
    default:
      return state;
  }
}

export function useAnnotations() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const nextIdRef = useRef(1);

  const addAnnotation = useCallback((type, data) => {
    const id = `ann-${nextIdRef.current++}`;
    const annotation = {
      id, type, ...data,
      createdAt: new Date().toISOString(),
      author: 'User',
      replies: [],
    };
    dispatch({ type: 'ADD', annotation });
    return id;
  }, []);

  const removeAnnotation = useCallback((id) => {
    dispatch({ type: 'REMOVE', id });
  }, []);

  const updateAnnotation = useCallback((id, changes) => {
    dispatch({ type: 'UPDATE', id, changes });
  }, []);

  const undo  = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo  = useCallback(() => dispatch({ type: 'REDO' }), []);
  const clear = useCallback(() => { nextIdRef.current = 1; dispatch({ type: 'CLEAR' }); }, []);

  const addReply = useCallback((annotationId, text) => {
    const ann = state.annotations.find(a => a.id === annotationId);
    if (!ann) return;
    dispatch({
      type: 'UPDATE',
      id: annotationId,
      changes: {
        replies: [...(ann.replies || []), {
          id: `reply-${Date.now()}`,
          text,
          author: 'User',
          createdAt: new Date().toISOString(),
        }],
      },
    });
  }, [state.annotations]);

  return {
    annotations: state.annotations,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    addAnnotation,
    removeAnnotation,
    updateAnnotation,
    undo,
    redo,
    clear,
    addReply,
  };
}
