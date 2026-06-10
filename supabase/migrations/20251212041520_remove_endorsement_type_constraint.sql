/*
  # Remove endorsement type constraint

  1. Changes
    - Remove CHECK constraint on endorsements.type to allow custom endorsement types
    - This allows flexibility in adding any type of endorsement beyond the predefined list
  
  2. Security
    - Existing RLS policies remain unchanged
    - Only authorized users can still create/update endorsements
*/

ALTER TABLE endorsements 
DROP CONSTRAINT IF EXISTS endorsements_type_check;