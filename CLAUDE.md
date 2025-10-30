# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Principles

**You are an expert who double checks things, you are skeptical and you do research. I am not always right. Neither are you, but we both strive for accuracy.**

- Always verify assumptions by reading actual code instead of guessing
- Question inconsistencies and ask for clarification when needed
- Use Grep, Read, and other tools to research before answering
- Admit uncertainty rather than providing incorrect information
- Cross-reference related files to ensure consistency across the codebase

## Project Overview

BladeXfunctions is a JavaScript function library designed for integration with low-code/no-code platforms. This repository serves as a centralized code library containing reusable business logic functions for Enterprise Resource Planning (ERP) systems. The functions are organized by functional modules and are intended to be imported or copied into low-code platform applications to handle complex business processes including inventory management, sales, purchasing, manufacturing, and financial operations.

## Architecture

### Module Organization
The codebase is organized into functional modules, each representing a business area:

- **Sales Operations**: Sales Order, Sales Invoice, Sales Return, Quotation, Goods Delivery
- **Purchasing**: Purchase Order, Purchase Requisition, Purchase Invoice, Purchase Return  
- **Inventory Management**: Stock Movement, Stock Adjustment, Goods Receiving, Putaway
- **Manufacturing**: Production Order, Process Route, Bill of Material
- **Master Data**: Item, Customer, Supplier, Plant Stock Balance, Serial Number
- **Location Management**: Bin Location, Transfer Order

### Function Categories
Each module contains functions following consistent naming patterns:

- **onMounted**: Initialization functions that set up forms and load initial data
- **onChangeX**: Event handlers for form field changes (e.g., onChangeCustomer, onChangeItem)
- **saveAsDraft**: Functions to save records in draft status
- **saveAsIssued/saveAsCompleted**: Functions to save and change record status
- **validation**: Functions for data validation (quantity, serial numbers, etc.)
- **fetchData**: Functions to retrieve and populate data from database
- **calculation**: Functions for computing totals, taxes, and other derived values

### Common Patterns

#### Prefix Generation
Most modules use a consistent prefix generation system for document numbering:
```javascript
const generatePrefix = (runNumber, now, prefixData) => {
  let generated = prefixData.current_prefix_config;
  generated = generated.replace("prefix", prefixData.prefix_value);
  generated = generated.replace("suffix", prefixData.suffix_value);
  // Date and running number replacements...
}
```

#### Database Operations
Functions use a `db` object for database operations with collections following naming conventions:
- Collection names typically match the module (e.g., "sales_order", "purchase_order")
- Standard fields: `organization_id`, `is_deleted`, `is_active`
- Status tracking with values like "Draft", "Issued", "Completed", "Cancelled"

#### Form Validation
Consistent validation pattern using required fields arrays:
```javascript
const validateForm = (data, requiredFields) => {
  const missingFields = requiredFields.filter((field) => {
    // Validation logic for different field types
  });
}
```

#### Status Management
Status display functions follow consistent patterns:
```javascript
const showStatusHTML = (status) => {
  switch (status) {
    case "Draft": this.display(["draft_status"]); break;
    case "Issued": this.display(["issued_status"]); break;
    // Other status cases...
  }
}
```

### Configuration Files
- **JSON Configuration**: Each module may have JSON configuration files (e.g., GD.json, SO.json) containing UI component definitions with Chinese language elements and form configurations
- **Prefix Configuration**: Document numbering is managed through prefix_configuration collection with support for date-based and sequential numbering

### Business Logic Patterns

#### Multi-status Workflow
Documents typically follow status progression:
1. **Draft** → **Issued** → **In Progress** → **Completed** 
2. Some documents support **Posted** status for accounting integration
3. **Cancelled** status available for workflow termination

#### Organization-based Multi-tenancy
All operations are scoped by `organization_id` for multi-tenant support.

#### Accounting Integration
Functions check for accounting integration type and handle posting to external accounting systems when configured.

## Development Notes

### Function Library Usage
- This is a **code library repository** - functions are designed to be copied/imported into low-code platforms
- Each function is self-contained and can be used independently in low-code applications
- Functions assume integration with low-code platform APIs (database access via `db` object, form manipulation via `this.setData()`, etc.)

### File Structure
- Functions are organized in folders by business module for easy browsing and selection
- Each JavaScript file typically contains 1-3 related functions
- Consistent naming: ModuleNameActionType.js (e.g., SOsaveAsDraft.js, GDonMounted.js)
- Choose and adapt functions based on your specific low-code platform requirements

### Code Style
- Functions use modern JavaScript (const/let, async/await, arrow functions)
- Database queries use method chaining pattern compatible with common low-code database APIs
- Error handling through try-catch blocks
- Form manipulation assumes low-code platform context (`this.setData()`, `this.display()`)

### Integration Guidelines
- When adding functions to low-code platforms, verify database collection names match your schema
- Adapt field names and validation rules to match your specific business requirements
- Test functions in your low-code environment before deployment
- Modify organization-based filtering if not using multi-tenant architecture

### Testing and Validation
- No automated testing framework - functions should be tested within target low-code platform
- Validation is handled through dedicated validation functions that can be reused
- Business rules enforced through database queries and conditional logic

When working with this codebase, treat it as a reference library. Copy and adapt functions for your specific low-code implementation, following the established patterns for consistency. Pay attention to organization-based filtering, status management, and the prefix generation system when customizing functionality for your platform.