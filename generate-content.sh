#!/bin/bash

# Output file
OUTPUT_FILE="nodejs_project_contents.txt"

# Remove the output file if it already exists
rm -f "$OUTPUT_FILE"

# Function to process files recursively
process_files() {
  for file in "$1"/*; do
    # Skip common Node.js build and dependency directories
    if [[ -d "$file" && (
      "$file" == *"/node_modules" ||
      "$file" == *"/dist" ||
      "$file" == *"/out" ||
      "$file" == *"/release" ||
      "$file" == *"/.webpack" ||
      "$file" == *"/build" ||
      "$file" == *"/.git" ||
      "$file" == *"/LICENSE" ||
      "$file" == *"/.vscode" ||
      "$file" == *"/coverage"
    ) ]]; then
      continue
    fi

    # If it's a directory, recursively process it
    if [[ -d "$file" ]]; then
      process_files "$file"
    elif [[ -f "$file" ]]; then
      # Get relative path
      relative_path="${file#$(pwd)/}"

      # Skip specific files and file types
      if [[ "$relative_path" == *".log" ||
            "$relative_path" == *".tmp" ||
            "$relative_path" == *"package-lock.json" ||
            "$relative_path" == *"yarn.lock" ||
            "$relative_path" == *"npm-debug.log" ||
            "$relative_path" == *"this-script.sh" ]]; then
        continue
      fi

      # Process source and configuration files
      if [[ "$relative_path" == *".js" ||
            "$relative_path" == *".jsx" ||
            "$relative_path" == *".ts" ||
            "$relative_path" == *".tsx" ||
            "$relative_path" == *".json" ||
            "$relative_path" == *".yml" ||
            "$relative_path" == *".yaml" ||
            "$relative_path" == *".md" ||
            "$relative_path" == *"package.json" ||
            "$relative_path" == *"README.md" ]]; then

        # Add filename and relative path as a header to the output
        echo "
===== $relative_path =====
" >> "$OUTPUT_FILE"
        # Append the content of the file
        cat "$file" >> "$OUTPUT_FILE"
      fi
    fi
  done
}

# Start processing the current directory
process_files "$(pwd)"

# Notify the user
echo "Content of relevant Node.js project files has been output to $OUTPUT_FILE"