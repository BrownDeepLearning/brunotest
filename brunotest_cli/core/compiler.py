"""
This module contains the compiler logic for Brunotest, which determines
how solution code and chaff files get transformed into partial implementations.
"""

from dataclasses import dataclass
from typing import Optional

REGION_START_STRING = "### Region: "
REGION_START_STRING_LENGTH = len(REGION_START_STRING)
REGION_END_STRING = "### EndRegion"
REGION_END_STRING_LENGTH = len(REGION_END_STRING)


@dataclass
class FileCompilationResult:
    """The result of compiling a file."""

    success: bool
    regions: list[str]


def find_region(template: str, search_start: int = 0) -> Optional[tuple[int, int, str]]:
    """
    Finds the next region in the template file, starting at the given index.
    """
    region_start_index = template.find(REGION_START_STRING, search_start)

    if region_start_index == -1:
        return None

    region_end_index = template.find("### EndRegion", region_start_index)
    region_name_end = template.find("\n", region_start_index)
    region_name = template[
        region_start_index + REGION_START_STRING_LENGTH : region_name_end
    ].strip()

    return (region_start_index, region_end_index, region_name)


def compile_file(
    template_file_path: str,
    new_file_path: str,
    replacements: dict[str, str],
) -> None:
    """
    Reads and compiles a template file, writing the result to a new file.
    """

    # Read the template file
    with open(template_file_path, "r", encoding="utf-8") as template_file:
        template = template_file.read()

    # Find all the regions in the template
    search_start = 0
    while True:
        region = find_region(template, search_start)

        if not region:
            break

        (region_start_index, region_end_index, region_name) = region

        # Have located the region, so now replace it with the contents of the region
        # that are defined in `replacements`
        # Note: We will need to figure out the amount of indentation that the region has,
        # and then indent the replacement accordingly
        # Find the index of the last newline before region_start_index
        last_newline_index = template.rfind("\n", 0, region_start_index)
        indentation = template[last_newline_index + 1 : region_start_index]

        if not region_name in replacements:
            # Don't replace it, but we need to make sure we ignore it in the future
            search_start = region_end_index + REGION_END_STRING_LENGTH
            continue
            # raise Exception(f"Could not find replacement for region '{region_name}'.")

        replacement = replacements[region_name]
        replacement = replacement.replace("\n", "\n" + indentation)
        template = (
            template[:region_start_index]
            + replacement
            + template[region_end_index + REGION_END_STRING_LENGTH :]
        )

    # Write the template back to file
    with open(new_file_path, "w", encoding="utf-8") as new_file:
        new_file.write(template)


def read_chaff_file(chaff_file_path: Optional[str]) -> dict[str, str]:
    """
    Reads a chaff file and creates a mapping between regions and their replacements.
    """
    # Read the chaff file
    if not chaff_file_path:
        return {}

    with open(chaff_file_path, "r", encoding="utf-8") as chaff_file:
        chaff = chaff_file.read()

    replacements = {}
    # Split the chaff file into regions
    while True:
        region = find_region(chaff)
        if not region:
            break

        (region_start_index, region_end_index, region_name) = region
        next_line = chaff.find("\n", region_start_index) + 1
        replacement = chaff[next_line:region_end_index].strip()
        replacements[region_name] = replacement
        chaff = chaff[region_end_index + REGION_END_STRING_LENGTH :]

    return replacements
