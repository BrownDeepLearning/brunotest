"""
This module contains helper functions for importing modules from a given path.
"""

import importlib.abc
import importlib.machinery
import importlib.util


def import_module_from_path(module_name: str, module_path: str):
    """
    Imports a module from a given path.
    """
    spec = importlib.util.spec_from_file_location(module_name, module_path)

    if not spec or not spec.loader:
        raise FileNotFoundError(f"Could not find module at path {module_path}")

    module = importlib.util.module_from_spec(spec)

    spec.loader.exec_module(module)
    return module


def import_module_without_cache(module_name: str, module_path: str):
    """
    Imports a module from a specific path without caching the result.

    This is important, because it allows us to import different
    modules from the solution/student submission, which otherwise
    have the same name.
    """
    importlib.invalidate_caches()
    return import_module_from_path(module_name, module_path)
