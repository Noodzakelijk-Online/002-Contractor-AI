import { useState, useEffect } from 'react';

function usePersistentState(key, defaultValue) {
  // Get the initial state from localStorage, or use the default value
  const [state, setState] = useState(() => {
    const storedValue = localStorage.getItem(key);
    try {
      return storedValue ? JSON.parse(storedValue) : defaultValue;
    } catch (error) {
      console.error("Error parsing JSON from localStorage", error);
      return defaultValue;
    }
  });

  // Use useEffect to save the state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.error("Error saving to localStorage", error);
    }
  }, [key, state]);

  return [state, setState];
}

export default usePersistentState;
